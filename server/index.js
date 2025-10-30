const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");

// --- 1. New Imports ---
const multer = require("multer");
const path = require("path");

require("dotenv").config();

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT"],
  },
});

const port = 5001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- 2. Serve Static Files ---
// This line makes the 'uploads' folder public
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- 3. Multer Storage Configuration ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save to 'uploads' folder
  },
  filename: (req, file, cb) => {
    // Create a unique filename: fieldname-timestamp.extension
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

const upload = multer({ storage: storage });

// --- 4. Authentication Routes (Signup is modified) ---

// Use 'upload.single('avatar')' middleware to handle the file
app.post("/signup", upload.single("avatar"), async (req, res) => {
  // Text fields are in req.body
  const { username, email, password } = req.body;

  // The file is in req.file
  let avatarUrl = null;
  if (req.file) {
    // Construct the full URL for the frontend
    avatarUrl = `http://localhost:${port}/uploads/${req.file.filename}`;
  }

  if (!username || !email || !password) {
    return res
      .status(400)
      .json({ error: "Username, email, and password are required." });
  }

  try {
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        avatarUrl, // Save the new URL
      },
    });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    const { passwordHash: _, ...safeUser } = user;
    res.status(201).json({ user: safeUser, token });
  } catch (error) {
    if (error.code === "P2002")
      return res
        .status(409)
        .json({ error: "Username or email already exists." });
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// (Login route remains the same)
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required." });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found." });
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(401).json({ error: "Invalid credentials." });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    const { passwordHash: _, ...safeUser } = user;
    res.status(200).json({ user: safeUser, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// --- Auth Middleware (No Change) ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- User & Friend Routes (Updated to include avatarUrl) ---

app.get("/users/find", authenticateToken, async (req, res) => {
  const { username } = req.query;
  if (username === undefined)
    return res
      .status(400)
      .json({ error: "Username query parameter is required." });

  try {
    const users = await prisma.user.findMany({
      where: {
        username: { contains: username, mode: "insensitive" },
        id: { not: req.user.id },
      },
      select: { id: true, username: true, avatarUrl: true }, // Ensure avatarUrl
      take: 10,
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Something went wrong." });
  }
});

// (Friend request routes are the same, no need to change)
app.post("/friends/request", authenticateToken, async (req, res) => {
  const { receiverId } = req.body;
  const requesterId = req.user.id;
  if (requesterId === receiverId)
    return res
      .status(400)
      .json({ error: "You cannot send a friend request to yourself." });
  try {
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, receiverId },
          { requesterId: receiverId, receiverId: requesterId },
        ],
      },
    });
    if (existing)
      return res
        .status(409)
        .json({ error: "A friend request or friendship already exists." });
    const newRequest = await prisma.friendship.create({
      data: { requesterId, receiverId },
    });
    res.status(201).json(newRequest);
  } catch (error) {
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.put("/friends/respond", authenticateToken, async (req, res) => {
  const { friendshipId, status } = req.body;
  const receiverId = req.user.id;
  if (!status || (status !== "ACCEPTED" && status !== "DECLINED"))
    return res.status(400).json({ error: "Invalid status." });
  try {
    const updatedRequest = await prisma.friendship.update({
      where: { id: friendshipId, receiverId: receiverId },
      data: { status: status },
    });
    res.json(updatedRequest);
  } catch (error) {
    res.status(500).json({ error: "Could not update request." });
  }
});

// (Friend/Pending routes updated to include avatarUrl)
app.get("/friends/pending", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const requests = await prisma.friendship.findMany({
      where: { receiverId: userId, status: "PENDING" },
      include: {
        requester: { select: { id: true, username: true, avatarUrl: true } },
      }, // Ensure avatarUrl
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch pending requests." });
  }
});

app.get("/friends/all", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const friendships = await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      include: {
        requester: { select: { id: true, username: true, avatarUrl: true } }, // Ensure avatarUrl
        receiver: { select: { id: true, username: true, avatarUrl: true } }, // Ensure avatarUrl
      },
    });
    const friends = friendships.map((fs) =>
      fs.requesterId === userId ? fs.receiver : fs.requester
    );
    res.json(friends);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch friends." });
  }
});

// --- Chat Routes (Updated to include avatarUrl) ---

app.get("/chats/find/:friendId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;
  try {
    let chat = await prisma.chat.findFirst({
      where: {
        AND: [
          { participants: { some: { id: userId } } },
          { participants: { some: { id: friendId } } },
        ],
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { id: true, username: true, avatarUrl: true } },
          }, // Ensure avatarUrl
        },
      },
    });

    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          participants: { connect: [{ id: userId }, { id: friendId }] },
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: {
              author: { select: { id: true, username: true, avatarUrl: true } },
            }, // Ensure avatarUrl
          },
        },
      });
    }
    res.json(chat);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not find or create chat." });
  }
});

// --- Socket.io Logic (Updated to include avatarUrl) ---
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("joinRoom", (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined room ${chatId}`);
  });

  socket.on("sendMessage", async ({ chatId, authorId, content }) => {
    try {
      const newMessage = await prisma.message.create({
        data: { content, chatId, authorId },
        include: {
          author: { select: { id: true, username: true, avatarUrl: true } }, // Ensure avatarUrl
        },
      });
      io.to(chatId).emit("receiveMessage", newMessage);
    } catch (error) {
      console.error("Error saving or broadcasting message:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// --- Start Server ---
server.listen(port, () => {
  console.log(
    `🚀 Server (with WebSockets) running at http://localhost:${port}`
  );
});
