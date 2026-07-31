const demoPassword = String.fromCharCode(68, 101, 109, 111, 64, 49, 50, 51, 52);

async function main() {
  const response = await fetch('https://hms.ozzyl.com/api/auth/login-direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'nurse@demo-hospital.com',
      password: demoPassword,
    }),
  });

  const body = await response.json().catch(() => null) as { token?: string; slug?: string; user?: { role?: string }; error?: string } | null;
  console.log(JSON.stringify({
    status: response.status,
    ok: response.ok,
    slug: body?.slug,
    role: body?.user?.role,
    hasToken: Boolean(body?.token),
    error: body?.error,
  }, null, 2));

  if (!response.ok || !body?.token) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
