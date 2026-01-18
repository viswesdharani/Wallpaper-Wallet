const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { v4: uuidv4 } = require("uuid");

ffmpeg.setFfmpegPath(ffmpegPath);


const app = express();
app.use(express.json());
app.use(cors());

const uploadDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "outputs");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// serve generated videos
app.use("/outputs", express.static(outputDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({ storage });

// ✅ MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/galleryDB")
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

// ✅ User schema (GLOBAL)
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);


// ✅ REGISTER API
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email & password required" });
  }

  // ✅ email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(400).json({ message: "User already exists. Please login." });
  }

  await User.create({ email, password });

  res.json({ message: "✅ Account created successfully. Please login." });
});


// ✅ LOGIN API
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, password });
  if (!user) {
    return res.status(401).json({ message: "Invalid Email or Password" });
  }

  const token = jwt.sign({ id: user._id }, "SECRET_KEY", { expiresIn: "1h" });

  res.json({ message: "Login success", token });
});


// ✅ Verify Token
app.get("/verify", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    jwt.verify(token, "SECRET_KEY");
    res.json({ message: "Token valid" });
  } catch {
    res.status(401).json({ message: "Token invalid" });
  }
});


app.post("/ai-generate", upload.single("image"), async (req, res) => {
  try {
    let imagePath;

    if (req.file) {
      imagePath = req.file.path;
    } 
    else if (req.body.imageUrl) {
      const imgUrl = req.body.imageUrl;

      const filename = uuidv4() + ".jpg";
      imagePath = path.join(uploadDir, filename);

      const response = await axios.get(imgUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(imagePath, response.data);
    } 
    else {
      return res.status(400).json({ message: "No image selected" });
    }

    const outName = uuidv4() + ".mp4";
    const outputPath = path.join(outputDir, outName);

    ffmpeg(imagePath)
      .loop(8)
      .videoFilters([
        "scale=1280:720",
        "zoompan=z='min(zoom+0.0009,1.20)':d=240:s=1280x720"
      ])
      .outputOptions([
        "-t 8",
        "-r 30",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        "-preset veryslow",
        "-crf 18"
      ])
      .save(outputPath)
      .on("end", () => {
        res.json({
          videoUrl: `http://localhost:5000/outputs/${outName}`
        });
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).json({ message: "Video generation failed" });
      });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


app.listen(5000, () => console.log("✅ Server running on http://localhost:5000"));
