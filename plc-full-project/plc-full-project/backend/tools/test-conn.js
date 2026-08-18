// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
(async () => {
  try {
    const pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
      poolMin: 1, poolMax: 1, poolIncrement: 0, poolTimeout: 8,
    });
    const conn = await pool.getConnection();
    const r = await conn.execute('SELECT 1 AS OK FROM DUAL');
    console.log('Oracle connected OK:', JSON.stringify(r.rows[0]));
    await conn.close();
    await pool.close(5);
  } catch(e) {
    console.log('FAILED:', e.message);
  }
})();