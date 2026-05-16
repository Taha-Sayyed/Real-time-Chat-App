import express from "express";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import dns from "node:dns/promises";
import { createClient } from "redis";

//👇For Development only
dns.setServers(["1.1.1.1"]);
dotenv.config();
//👆For Development only

connectDb();

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient
  .connect()
  .then(() => console.log("✅connected to redis"))
  .catch(console.error);

const app = express();

const port = process.env.PORT;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
