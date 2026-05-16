import express from "express";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import dns from "node:dns/promises";

//👇For Development only
dns.setServers(["1.1.1.1"]);
dotenv.config();
//👆For Development only

connectDb();

const app = express();

const port = process.env.PORT;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
