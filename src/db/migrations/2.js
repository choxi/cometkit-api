import Connection from "../connection.js"

let db = new Connection()

db.query(`
  CREATE TABLE blog_posts (
    id    bigserial NOT NULL,
    title text NOT NULL,
    body  text,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY(id),
    UNIQUE(title)
  )
`, (error, response) => {
  if(error)    console.log(error)
  if(response) console.log(response)
})
