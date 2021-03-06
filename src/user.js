import Connection from "./db/connection.js"
import bcrypt     from "bcrypt"
import StyleGuide from "./StyleGuide.js"

export default class User {
  constructor({ id, name, email, password_hash, token, key_name, stripe_token, updated_at, created_at }) {
    this.id           = id
    this.name         = name
    this.email        = email
    this.passwordHash = password_hash
    this.token        = token
    this.keyName      = key_name
    this.stripeToken  = stripe_token
    this.updatedAt    = updated_at
    this.createdAt    = created_at
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      token: this.token,
      key: this.key,
      updatedAt: this.updateAt,
      createdAt: this.createdAt
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

  styleGuides() {
    return new Promise((resolve, reject) => {
      let db = new Connection()
      let query = `
        SELECT * FROM style_guides
        INNER JOIN roles ON roles.source_id = style_guides.id
        WHERE
          roles.source_type = 'StyleGuide' AND
          roles.user_id = $1
      `
      let values = [ this.id ]

      db.query(query, values)
      .then((results) => {
        let guides = results.rows.map(row => new StyleGuide(row))
        resolve(guides)
      })
      .catch(reject)
    })
  }

  findStyleGuide(githubRepo) {
    return new Promise((resolve, reject) => {
      let db = new Connection()
      let query = `
        SELECT 
          * FROM style_guides 
        INNER JOIN 
          roles ON roles.source_id=style_guides.id
        WHERE 
          roles.source_type = 'StyleGuide' AND
          roles.user_id = $1 AND
          style_guides.github_repo = $2
      `

      let values = [ this.id, githubRepo ]

      db.query(query, values).then((result) => {
        if(result.rows[0])
          resolve(new StyleGuide(result.rows[0]))
        else
          resolve()
      })
      .catch(reject)
    })
  }

  static create(attributes) {
    return new Promise((resolve, reject) => {
      let db = new Connection()

      let salt = bcrypt.genSaltSync(10)
      let hash = bcrypt.hashSync(attributes.password, salt)
      let now  = new Date()

      let sql    = "INSERT INTO users (name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING *"
      let values = [ attributes.name, attributes.email, hash, now, now]

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

          if(userData && password && bcrypt.compareSync(password, userData.password_hash))
            resolve(new User(userData))
          else
            resolve()
        })
        .catch(reject)
      }
    })
  }

  static find(id) {
    return new Promise((resolve, reject) => {
      let db      = new Connection()
      let sql     = "SELECT * FROM users WHERE id = $1"
      let values  = [ id ]

      db.query(sql, values)
      .then((result) => {
        if(result.rows[0])
          resolve(new User(result.rows[0]))
        else
          resolve()
      })
      .catch(reject)
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
