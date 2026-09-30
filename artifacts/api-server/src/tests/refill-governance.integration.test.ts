import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import express from 'express';
import supertest from 'supertest';

// A dedicated, disposable local database is mandatory. Never run this fixture
// creation against a Replit or production DATABASE_URL.
const target = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
if (process.env.REFILL_TEST_DB !== '1' || !['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/refill_governance_test') {
  throw new Error('Refill governance integration tests require a dedicated local refill_governance_test database and REFILL_TEST_DB=1.');
}
process.env.SESSION_SECRET = 'isolated-refill-governance-tests-only';
process.env.UC_REFILL_GOVERNANCE_PREVIEW = 'true';

const [{ pool }, { issueToken }, { default: router }] = await Promise.all([
  import('@workspace/db'), import('../lib/jwt.js'), import('../routes/refill-governance.js'),
]);
const app = express();
app.use(express.json());
app.use('/api', router);
const api = supertest(app);
const auth = (id: string, role: string) => ({ Authorization: `Bearer ${issueToken({ id, email: `${id}@example.test`, role, type: 'team-session' })}` });
const url = '/api/uc/admin/refill/governance';
const reason = { reason: 'Reviewed for the isolated pilot test.' };

test('governance is off by default and requires a live team administrator', async () => {
  process.env.UC_REFILL_GOVERNANCE_PREVIEW = 'false';
  assert.equal((await api.get(`${url}/stations`)).status, 404);
  process.env.UC_REFILL_GOVERNANCE_PREVIEW = 'true';
  assert.equal((await api.get(`${url}/stations`)).status, 401);
});

test('station, operator and immutable rule approvals are enforced in PostgreSQL', async () => {
  try {
    await pool.query('CREATE TABLE team_users (id text PRIMARY KEY, role text NOT NULL, is_active boolean NOT NULL)');
    await pool.query('CREATE TABLE uc_locations (id text PRIMARY KEY, name text NOT NULL, active boolean NOT NULL, verified boolean NOT NULL)');
    const migration = await readFile(new URL('../../../../lib/db/migrations/0054_uc_refill_governance.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration); // additive migration is repeatable
    await pool.query("INSERT INTO team_users VALUES ('maker','admin',true),('checker','admin',true),('operator','member',true)");
    await pool.query("INSERT INTO uc_locations VALUES ('pilot-1','Pilot station',true,true),('unverified','Unverified station',true,false)");

    assert.equal((await api.get(`${url}/stations`).set(auth('operator', 'admin'))).status, 403); // stale token role never grants admin
    assert.equal((await api.post(`${url}/stations/unverified/enable`).set(auth('maker', 'admin')).send(reason)).status, 409);
    assert.equal((await api.post(`${url}/stations/pilot-1/enable`).set(auth('maker', 'admin')).send(reason)).status, 200);
    assert.equal((await api.post(`${url}/stations/pilot-1/operators/operator/grant`).set(auth('maker', 'admin')).send(reason)).status, 200);
    let scope = await api.get('/api/uc/station/refill/scope').set(auth('operator', 'member'));
    assert.equal(scope.status, 200);
    assert.deepEqual(scope.body, { stations: [{ stationId: 'pilot-1', name: 'Pilot station' }], mayDispense: false });

    const now = Date.now();
    const proposal = {
      campaignKey: 'pilot_campaign', version: 1, stationId: 'pilot-1', eligibilityPolicy: 'manual_review', maxGrants: 3,
      startsAt: new Date(now + 3600_000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString(),
      scenario: { pricingVersion: 'cost-evidence-1', campaignVersion: 'pilot_campaign:1', volumeMl: 1000,
        cashChargeMinor: 0, sponsorFundingMinor: 1000,
        costs: { waterPerLitreMinor: 100, paymentMinor: 0, deliverySupportMinor: 50, benefitObligationMinor: 10, taxMinor: 0 } },
    };
    assert.equal((await api.post(`${url}/rules`).set(auth('operator', 'admin')).send(proposal)).status, 403);
    const created = await api.post(`${url}/rules`).set(auth('maker', 'admin')).send(proposal);
    assert.equal(created.status, 200);
    assert.equal(created.body.status, 'proposed');
    assert.equal((await api.post(`${url}/rules`).set(auth('maker', 'admin')).send({ ...proposal, maxGrants: 4 })).status, 409);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth('maker', 'admin')).send(reason)).status, 403);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth('checker', 'admin')).send(reason)).status, 200);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth('checker', 'admin')).send(reason)).body.changed, false);
    const missingCost = await api.post(`${url}/rules`).set(auth('maker', 'admin')).send({ ...proposal, version: 2,
      scenario: { ...proposal.scenario, campaignVersion: 'pilot_campaign:2', costs: { ...proposal.scenario.costs, taxMinor: null } } });
    assert.equal(missingCost.status, 200);
    assert.equal((await api.post(`${url}/rules/${missingCost.body.id}/approve`).set(auth('checker', 'admin')).send(reason)).status, 422);
    const unfunded = await api.post(`${url}/rules`).set(auth('maker', 'admin')).send({ ...proposal, version: 3,
      scenario: { ...proposal.scenario, campaignVersion: 'pilot_campaign:3', sponsorFundingMinor: 0 } });
    assert.equal(unfunded.status, 200);
    assert.equal((await api.post(`${url}/rules/${unfunded.body.id}/approve`).set(auth('checker', 'admin')).send(reason)).status, 422);
    await assert.rejects(pool.query('UPDATE uc_refill_campaign_versions SET max_grants=999 WHERE id=$1', [created.body.id]), /append-only/);
    await assert.rejects(pool.query('DELETE FROM uc_refill_campaign_actions WHERE campaign_version_id=$1', [created.body.id]), /append-only/);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/suspend`).set(auth('maker', 'admin')).send(reason)).status, 200);
    const listed = await api.get(`${url}/rules`).set(auth('checker', 'admin'));
    assert.equal(listed.body.find((rule: { id: string }) => rule.id === created.body.id)?.status, 'suspended');

    await pool.query("UPDATE team_users SET is_active=false WHERE id='operator'");
    scope = await api.get('/api/uc/station/refill/scope').set(auth('operator', 'member'));
    assert.equal(scope.status, 403);
    await pool.query("UPDATE team_users SET is_active=true WHERE id='operator'");
    assert.equal((await api.post(`${url}/stations/pilot-1/suspend`).set(auth('maker', 'admin')).send(reason)).status, 200);
    scope = await api.get('/api/uc/station/refill/scope').set(auth('operator', 'member'));
    assert.deepEqual(scope.body, { stations: [], mayDispense: false });
    assert.equal((await api.post(`${url}/stations/pilot-1/enable`).set(auth('maker', 'admin')).send(reason)).status, 403);
    assert.equal((await api.post(`${url}/stations/pilot-1/enable`).set(auth('checker', 'admin')).send(reason)).status, 200);
    scope = await api.get('/api/uc/station/refill/scope').set(auth('operator', 'member'));
    assert.deepEqual(scope.body, { stations: [], mayDispense: false }); // stale grant cannot revive
    assert.equal((await api.post(`${url}/stations/pilot-1/operators/operator/grant`).set(auth('checker', 'admin')).send(reason)).status, 200);
    scope = await api.get('/api/uc/station/refill/scope').set(auth('operator', 'member'));
    assert.equal(scope.body.stations.length, 1);
  } finally {
    await pool.end();
  }
});
