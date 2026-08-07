const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Serve index.html for the root route
app.get("/", (req, res) => {
    // res.sendFile(path.join(__dirname, "public", "index.html"));
    res.redirect("home");
});

app.get("/home", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "home", "index.html"));
});

app.get("/editor", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "editor", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});