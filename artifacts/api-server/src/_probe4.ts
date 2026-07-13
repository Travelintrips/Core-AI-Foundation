import { db, aiEmployeesTable } from "@workspace/db";
const rows = await db.select().from(aiEmployeesTable);
console.log(JSON.stringify(rows.map(r=>({code:r.employeeCode, name:r.employeeName, slug:r.agentSlug, dept:r.departmentId})), null, 2));
process.exit(0);
