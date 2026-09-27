import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { forgotPassword } from "@/lib/team-auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (submitted) successHeading.current?.focus();
  }, [submitted]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-mono text-2xl leading-none font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ProjectHub</h1>
        </div>

        <Card>
          {submitted ? (
            <>
              <CardHeader className="pb-4">
                <h2 ref={successHeading} tabIndex={-1} className="font-semibold leading-none tracking-tight flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Check your email
                </h2>
                <CardDescription role="status">
                  If <strong>{email}</strong> is registered, you'll receive a reset link within a few minutes.
                  Check your spam folder if it doesn't arrive.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="w-full gap-2">
                  <Link href="/login">
                    <ArrowLeft className="w-4 h-4" /> Back to sign in
                  </Link>
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="w-4 h-4 text-primary" />
                  Reset password
                </CardTitle>
                <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} autoFocus autoComplete="email" />
                    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending…</> : "Send reset link"}
                  </Button>
                  <div className="text-center">
                    <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                      <Link href="/login">
                        <ArrowLeft className="w-3 h-3" /> Back to sign in
                      </Link>
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
