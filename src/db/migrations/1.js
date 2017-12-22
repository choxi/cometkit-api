import Connection from "../connection.js"

let db = new Connection()

db.query(`
  CREATE TABLE users (
    id    bigserial NOT NULL,
    email text NOT NULL,
    name  text,
    password_hash text NOT NULL,
    stripe_token text,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    PRIMARY KEY(id),
    UNIQUE(email)
  )
`, (error, response) => {
  if(error)    console.log(error)
  if(response) console.log(response)
})

db.query(`
  CREATE TABLE style_guides (
    id          bigserial PRIMARY KEY NOT NULL,
    github_repo text,
    created_at  TIMESTAMP,
    updated_at  TIMESTAMP
  )
`, (error, response) => {
  if(error)    console.log(error)
  if(response) console.log(response)
})

db.query(`
  CREATE TABLE roles (
    id          bigserial PRIMARY KEY NOT NULL,
    user_id     bigint NOT NULL,
    source_type text,
    source_id   bigint NOT NULL,
    created_at  TIMESTAMP,
    updated_at  TIMESTAMP
  )
`, (error, response) => {
  if(error) console.log(error)
  if(response) console.log(response)
})

