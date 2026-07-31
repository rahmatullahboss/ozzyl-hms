export function calculateAgeFromDateOfBirth(
  dateOfBirth: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;

  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()) || dob > now) return null;

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const birthMonth = dob.getUTCMonth();
  const currentDay = now.getUTCDate();
  const birthDay = dob.getUTCDate();

  if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
    age -= 1;
  }

  return Math.max(0, age);
}
