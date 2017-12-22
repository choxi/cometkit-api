import Connection from "./db/connection.js"

export default class Post {
  static async create({ title, body }) {
    return new Promise((resolve, reject) => {
      let db     = new Connection()
      let sql    = "INSERT INTO style_guides (github_repo, created_at, updated_at) VALUES ($1, $2, $3) RETURNING *"
      let values = [ githubRepo, now, now ]
      let styleGuide 

      db.transaction((client, commit, rollback) => {
        client.query(sql, values)
        .then((result) => {
          styleGuide  = new StyleGuide(result.rows[0])
          now         = new Date()
          let query   = "INSERT INTO roles (user_id, source_id, source_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)"
          let values  = [user.id, styleGuide.id, "StyleGuide", now, now]

          return client.query(query, values)
        })
        .then(commit)
        .then(() => {
          resolve(styleGuide)
        })
      })
    })
  }
}
