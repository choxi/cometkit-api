import Connection from "./connection.js"

let db = new Connection()
db.query(`
  drop schema public cascade;
  create schema public;
`, (error, response) => {
  if(error)    console.log(error)
  if(response) console.log(response)

  db.end()
})

