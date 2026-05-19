import express from "express";

import {
    loginUser,
    verifyUser,
    myProfile,
    getAllUsers,
    getAUser,
    updateName
} from "../controllers/user.js"

import { isAuth } from "../middleware/isAuth.js";
import { redisClient } from "../config/redis.js";
import { publishToQueue } from "../config/rabbitmq.js";
import { User } from '../model/User.js'
import { generateToken } from "../config/generateToken.js"

const router = express.Router();

router.post("/login", loginUser({ redisClient, publishToQueue }));
router.post("/verify", verifyUser({ redisClient, generateToken, UserModel: User }));
router.get("/me", isAuth, myProfile);
router.get("/user/all", isAuth, getAllUsers({UserModel:User}));
router.get("/user/:id", getAUser({UserModel:User}));
router.post("/update/user", isAuth, updateName({ UserModel: User, generateToken }));
export default router