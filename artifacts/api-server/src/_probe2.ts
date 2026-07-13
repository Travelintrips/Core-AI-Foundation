import { db, aiEmployeesTable, aiDepartmentsTable } from "@workspace/db";
const rows = await db.select().from(aiEmployeesTable);
console.log("employees count:", rows.length);
console.log(JSON.stringify(rows.map(r=>({name:r.employeeName, slug:r.agentSlug, status:r.status, dept:r.departmentId})), null, 2));
process.exit(0);
