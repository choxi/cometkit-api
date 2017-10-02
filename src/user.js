import Connection from "./db/connection.js"
import bcrypt     from "bcrypt"

export default class User {
  constructor({ id, name, email, password_hash, token, key_name, stripe_token }) {
    this.id           = id
    this.name         = name
    this.email        = email
    this.passwordHash = password_hash
    this.token        = token
    this.keyName      = key_name
    this.stripeToken  = stripe_token
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      token: this.token,
      key: this.key
    }
  }

  update(attributes) {
    return new Promise((resolve, reject) => {
      let db = new Connection()
      db.query("UPDATE users SET stripe_token = $1 WHERE id = $2 RETURNING *", [ attributes.stripe_token, this.id ])
      .then((results) => resolve(new User(results.rows[0])))
      .catch(reject)
    })
  }

  static create(attributes) {
    return new Promise((resolve, reject) => {
      let db = new Connection()

      let salt = bcrypt.genSaltSync(10)
      let hash = bcrypt.hashSync(attributes.password, salt)

      let sql    = "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *"
      let values = [ attributes.name, attributes.email, hash ]

      db.query(sql, values).then((result) => {
        let user = new User(result.rows[0])

        resolve({ user: user })
      })
      .catch(e => resolve({ error: { message: "Could not create user." }}))
    })
  }

  static authenticate({ email, password }) {
    return new Promise((resolve, reject) => {
      let db = new Connection()

      if(email && password) {
        let sql    = "SELECT * FROM users WHERE email = $1"
        let values = [ email ]

        db.query(sql, values)
        .then((result) => {
          let userData = result.rows[0]

          if(password && bcrypt.compareSync(password, userData.password_hash))
            resolve(new User(userData))
          else
            resolve()
        })
        .catch(reject)
      }
    })
  }

  static all() {
    return new Promise((resolve, reject) => {
      let db  = new Connection()
      let sql = "SELECT * FROM users"

      db.query(sql)
      .then((result) => {
        resolve(result.rows)
      })
    })
  }
}
