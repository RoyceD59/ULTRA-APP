'use strict';

/**
 * Port-discovery utilities for the Expo static build.
 *
 * Extracted into a separate module so they can be unit-tested without
 * triggering build.js's module-level side effects (findWorkspaceRoot at load
 * time and main() at the bottom).
 */

const net = require('net');

/**
 * Read METRO_PORT from the environment and parse it as an integer.
 * Returns null when the variable is not set.
 * Returns 0 when METRO_PORT=0 (OS auto-select sentinel; falsy in JS so
 * findMetroPort's `if (configuredPort)` will skip straight to port 0).
 * Throws a descriptive Error for any invalid value.
 */
function parseConfiguredMetroPort() {
  const value = process.env.METRO_PORT;
  if (!value) return null;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `METRO_PORT must be 0 (auto-select) or an integer between 1 and 65535: ${value}`,
    );
  }
  return port;
}

/**
 * Bind a probe server to `port` (use 0 for OS-assigned), record the actual
 * port, close the probe, then resolve with the port number so Metro can bind
 * it immediately afterward.
 *
 * Rejects with an EADDRINUSE system error when the port is already in use.
 */
function reserveAvailablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    const onError = (error) => {
      probe.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      const address = probe.address();
      const assignedPort =
        address && typeof address === 'object' ? address.port : null;

      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!assignedPort) {
          reject(new Error('Could not determine the available Metro port'));
          return;
        }
        resolve(assignedPort);
      });
    };

    probe.once('error', onError);
    probe.once('listening', onListening);
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Determine the port Metro should start on.
 *
 * 1. If METRO_PORT is set to a non-zero integer, try to reserve it.
 *    - If it is already in use (EADDRINUSE), warn and fall through.
 *    - Any other error is re-thrown.
 * 2. Fall back to OS-assigned ephemeral port (port 0).
 */
async function findMetroPort() {
  const configuredPort = parseConfiguredMetroPort();
  if (configuredPort) {
    try {
      return await reserveAvailablePort(configuredPort);
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      console.warn(
        `METRO_PORT=${configuredPort} is already in use; selecting an ephemeral port`,
      );
    }
  }

  // Port 0 asks the operating system for an available ephemeral port.
  return reserveAvailablePort(0);
}

module.exports = { parseConfiguredMetroPort, reserveAvailablePort, findMetroPort };
