import { db, aiDepartmentsTable } from "@workspace/db";
const rows = await db.select().from(aiDepartmentsTable);
console.log(JSON.stringify(rows.map(r=>({id:r.id, code:r.departmentCode, name:r.departmentName})), null, 2));
process.exit(0);
