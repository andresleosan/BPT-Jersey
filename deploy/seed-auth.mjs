// Siembra usuarios de prueba en el emulador de Auth, con el claim `role` que exige /account.
const base = "http://bpt-account-auth:9099";
const key = "demo-api-key";
const users = [
  { email: "adulto@bpt.test", password: "Passw0rd!", role: "adultStudent", name: "Adulto Demo" },
  { email: "tutor@bpt.test", password: "Passw0rd!", role: "guardian", name: "Tutor Demo" },
  { email: "teen@bpt.test", password: "Passw0rd!", role: "teenStudent", name: "Sam Demo" },
];

for (const u of users) {
  const signUp = await fetch(`${base}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password, displayName: u.name, returnSecureToken: true }),
  }).then((r) => r.json());
  const localId = signUp.localId;
  if (!localId) { console.log(u.email, "ya existe o falló:", signUp.error?.message); continue; }
  const res = await fetch(`${base}/identitytoolkit.googleapis.com/v1/projects/demo-bpt-jersey/accounts:update`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ localId, customAttributes: JSON.stringify({ role: u.role }) }),
  }).then((r) => r.json());
  console.log(u.email, u.role, res.error ? res.error.message : "OK");
}
