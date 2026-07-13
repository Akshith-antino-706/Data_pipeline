import db from '../src/config/database.js';
import CustomSegmentService from '../src/services/CustomSegmentService.js';
await db.query(`SET statement_timeout=120000`);
console.log('DB CURRENT_DATE:', (await db.query(`SELECT CURRENT_DATE d`)).rows[0].d.toISOString().slice(0,10));
for(const x of [1,3,7]){
  const tv=await CustomSegmentService.getCountPreview([{type:'contact',field:'travel_date_within',value:x,joinOp:'AND',exclude:false}]);
  const bk=await CustomSegmentService.getCountPreview([{type:'contact',field:'booking_date_within',value:x,joinOp:'AND',exclude:false}]);
  console.log(`X=${String(x).padEnd(2)}  travel_date within ±${x}d = ${JSON.stringify(tv)} users   |   booking_date within ±${x}d = ${JSON.stringify(bk)} users`);
}
process.exit(0);
