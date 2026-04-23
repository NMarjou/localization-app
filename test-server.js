import express from "express";

const app = express();
const PORT = 3000;

app.get("/health", (req, res) => {
  console.log("Health endpoint called");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Test server listening on port ${PORT}`);
});
