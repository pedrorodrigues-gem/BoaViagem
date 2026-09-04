const sql = require('mssql');
require('dotenv').config({ path: './config.env' });

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('Conectado à BD RotaCerta (SQL Server)');
        return pool;
    })
    .catch(err => {
        console.error('Erro de conexão à BD:', err);
        process.exit(1);
    });

module.exports = { sql, poolPromise };