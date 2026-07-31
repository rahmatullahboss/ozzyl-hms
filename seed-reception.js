const { execSync } = require('child_process');

// A pre-generated bcrypt hash for "12345678" (cost 10)
const passwordHash = "$2a$10$wE/.uX/Y.3gX2J8Gg7V/5uI2aI2g.vM7t1W8P7z.2W8.1a0/5aE2K";

try {
  console.log("Fetching tenant ID for Patient Care Hospital...");
  const tenantsJson = execSync(`npx wrangler d1 execute hms-super-admin-production-apac --remote --command="SELECT id FROM tenants WHERE name LIKE '%Patient Care%'" --json`, { encoding: 'utf-8' });
  
  // Clean up wrangler output which sometimes includes log lines before JSON
  const jsonMatch = tenantsJson.match(/\[.*\]/s);
  if (!jsonMatch) {
      throw new Error("Could not parse JSON from D1 response: " + tenantsJson);
  }
  
  const tenants = JSON.parse(jsonMatch[0]);
  if (!tenants[0].results || tenants[0].results.length === 0) {
      throw new Error("Patient Care Hospital not found in database.");
  }
  
  const tenantId = tenants[0].results[0].id;
  console.log(`Found tenant ID: ${tenantId}`);
  
  const query = `INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES ('nusratsony818@gmail.com', '${passwordHash}', 'Nusrat Jahan', 'reception', ${tenantId}, datetime('now'));`;
  
  console.log("Inserting user...");
  execSync(`npx wrangler d1 execute hms-super-admin-production-apac --remote --command="${query}"`, { stdio: 'inherit' });
  console.log('✅ Nusrat Jahan (Reception) seeded successfully!');
} catch (e) {
  console.error('Error:', e.message);
}
