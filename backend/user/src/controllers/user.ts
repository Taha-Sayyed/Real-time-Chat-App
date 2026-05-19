import TryCatch from "../config/TryCatch.js"
import { AuthenticatedRequest } from "../middleware/isAuth.js"
import { LoginUserDependencies, VerifyUserDependencies, UpdateNameDeps } from "../interfaces/interface_types.js"

export const loginUser = ({ redisClient, publishToQueue }: LoginUserDependencies) => TryCatch(async (req, res) => {
    const { email } = req.body

    const rateLimitKey = `otp:ratelimit:${email}`;
    const rateLimit = await redisClient.get(rateLimitKey);


    if (rateLimit) {
        res.status(429).json({
            message: "Too may requests. Please wait before requesting new otp",
        });
        return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const otpKey = `otp:${email}`;
    await redisClient.set(otpKey, otp, {
        EX: 300, //5 minutes
    });

    await redisClient.set(rateLimitKey, "true", {
        EX: 60, //1 min
    });

    const message = {
        to: email,
        subject: "Your otp code",
        body: `Your OTP is ${otp}. It is valid for 5 minutes`,
    };

    await publishToQueue("send-otp", message);

    res.status(200).json({
        message: "OTP sent to your mail",
    });
});

export const verifyUser = ({ redisClient,generateToken,UserModel }: VerifyUserDependencies) => TryCatch(async (req, res) => {
    const { email, otp: enteredOtp } = req.body;

    if (!email || !enteredOtp) {
        res.status(400).json({
            message: "Email and OTP Required",
        });
        return;
    }

    const otpKey = `otp:${email}`;
    const storedOtp = await redisClient.get(otpKey);

    if (!storedOtp || storedOtp !== enteredOtp) {
        res.status(400).json({
            message: "Invalid or expired OTP",
        });
        return;
    }

    await redisClient.del(otpKey);

    let user = await UserModel.findOne({ email });

    if (!user) {
        const name = email.slice(0, 8);
        user = await UserModel.create({ name, email });
    }

    const token = generateToken(user);

    res.json({
        message: "User Verified",
        user,
        token,
    });
})

export const myProfile = TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = req.user;
    res.json(user);
})

export const updateName = ({ UserModel, generateToken }: UpdateNameDeps) => TryCatch(async (req: AuthenticatedRequest, res) => {
    const user = await UserModel.findById(req.user?._id);

    if (!user) {
        res.status(404).json({
            message: "Please login",
        });
        return;
    }

    user.name = req.body.name;

    await user.save();

    const token = generateToken(user);

    res.json({
        message: "User Updated",
        user,
        token,
    });
});

export const getAllUsers = TryCatch(async (req: AuthenticatedRequest, res) => {
    const users = await User.find();

    res.json(users);
});

export const getAUser = TryCatch(async (req, res) => {
    const user = await User.findById(req.params.id);
    res.json(user);
});