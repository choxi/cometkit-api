import Connection from "./connection.js"

let db = new Connection()

db.query(`
  CREATE TABLE users (
    id    bigserial NOT NULL,
    email text NOT NULL,
    name  text,
    password_hash text NOT NULL,
    stripe_token text,
    PRIMARY KEY(id),
    UNIQUE(email)
  )
`, (error, response) => {
  if(error)    console.log(error)
  if(response) console.log(response)
})
