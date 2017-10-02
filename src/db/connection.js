import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export default class Connection {
  constructor() {
    this.query = pool.query.bind(pool)
    this.end   = pool.end.bind(pool)
  }

  transaction(callback) {
      pool.connect((err, client, done) => {
        const rollback = (err) => {
          return new Promise((resolve, reject) => {
            client.query('ROLLBACK', (err) => {
              if(err)
                console.error('Error rolling back client', err.stack)

              // release the client back to the pool
              done()
              resolve()
            })
          })
        }

        const commit = () => {
          return new Promise((resolve, reject) => {
            client.query('COMMIT', (err) => {
              if (err)
                console.error('Error committing transaction', err.stack)

              done()
              resolve()
            })
          })
        }

        client.query('BEGIN', (err) => {
          if(err) {
            rollback()
            return
          }

          callback(client, commit, rollback)
        })
      })
  }
}
