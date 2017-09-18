require("babel-register")

const App = require("./src/app.js").default
const app = new App()

app.start({ port: process.env.PORT })
