import express from "express";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
// import dns from "node:dns/promises";
import { connectRabbitMQ } from "./config/rabbitmq.js";
import cors from "cors";
import userRoutes from "./routes/user.js";
import { redisClient } from "./config/redis.js"

// //👇For Development only
// dns.setServers(["1.1.1.1"]);
// //👆For Development only

dotenv.config();
connectDb();
connectRabbitMQ();
redisClient
  .connect()
  .then(() => console.log("✅connected to redis"))
  .catch(console.error);

const app = express();
app.use(express.json());
app.use(cors());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    message: "Service is Healthy ✅"
  });
});

app.use("/api/v1", userRoutes);


const port = process.env.PORT;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
