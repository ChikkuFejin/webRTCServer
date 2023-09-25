const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const twilio = require("twilio");
const fs = require('fs');
const path = require('path');
var bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');



const PORT = process.env.PORT || 5002;
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());
app.use(fileUpload());

let connectedUsers = [];
let rooms = [];

app.use(express.static(path.join(__dirname, 'recordings')));

const recordingsDirectory = path.join(__dirname, 'recordings');

if (!fs.existsSync(recordingsDirectory)) {
  fs.mkdirSync(recordingsDirectory);
}

app.post('/api/upload', (req, res) => {
  const uploadedFile = req.files.video;

  if (uploadedFile) {
  
    const fileName = uuidv4() + '.webm'; // Generate a unique file name
    const filePath = path.join(recordingsDirectory, fileName);

  
    uploadedFile.mv(filePath, (err) => {
      if (err) {
        return res.status(500).send(err);
      }
      // File upload was successful
      return res.json({ message: 'File uploaded successfully' });
    });
  } else {
    return res.status(400).json({ message: 'No file uploaded' });
  }
});

// app.post('/api/upload', (req, res) => {

//   console.log('Uploading' ,req.files)
//   if (!req.files || Object.keys(req.files).length === 0) {
//     return res.status(400).send('No files were uploaded.');
//   }

//   const videoFile = req.files.video;
//   const fileName = uuidv4() + '.webm'; // Generate a unique file name
//   const filePath = path.join(recordingsDirectory, fileName);

//   videoFile.mv(filePath, (err) => {
//     if (err) {
//       return res.status(500).send(err);
//     }
//     res.send('Video uploaded and stored successfully.');
//   });
// });


app.get("/api/room-exists/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.find((room) => room.id === roomId);

  if (room) {
   
    if (room.connectedUsers.length > 3) {
      return res.send({ roomExists: true, full: true });
    } else {
      return res.send({ roomExists: true, full: false });
    }
  } else {
    
    return res.send({ roomExists: false });
  }
});

app.get("/api/get-turn-credentials", (req, res) => {
  const accountSid = "AC2f5b06cac74c268ead9f2cfe6e615117";
  const authToken = "37fa3b4085b0b9c31601b9090913e89a";

  const client = twilio(accountSid, authToken);

  // res.send({ token: null });
  try {
    client.tokens.create().then((token) => {
      res.send({ token });
    }).catch(err => {
      console.log("error occurred when fetching turn server credentials",err);
    });
  } catch (err) {
    console.log("error occurred when fetching turn server credentials");
    console.log(err);
    res.send({ token: null });
  }
});

const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {

  console.log(`user connected ${socket.id}`);

  socket.on("create-new-room", (data) => {
    createNewRoomHandler(data, socket);
  });

  socket.on("join-room", (data) => {
    joinRoomHandler(data, socket);
  });

  socket.on("disconnect", () => {
    disconnectHandler(socket);
  });

  socket.on("conn-signal", (data) => {
    signalingHandler(data, socket);
  });

  socket.on("conn-init", (data) => {
    initializeConnectionHandler(data, socket);
  });

  socket.on("direct-message", (data) => {
    directMessageHandler(data, socket);
  });
});



const createNewRoomHandler = (data_, socket) => {
  console.log("host is creating new room");

 let data=data_
  const { identity, onlyAudio,serviceId } = data;
  const roomId = serviceId;

  if(isExtistRoom(roomId)){
    data.roomId=roomId;
    joinRoomHandler(data, socket);
    return 
  }


  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };

 
  connectedUsers = [...connectedUsers, newUser];


  const newRoom = {
    id: roomId,
    connectedUsers: [newUser],
  };

  socket.join(roomId);

  rooms = [...rooms, newRoom];

  socket.emit("room-id", { roomId });


  socket.emit("room-update", { connectedUsers: newRoom.connectedUsers });
};

const isExtistRoom=(serviceId)=>{
  const room = rooms.find((room) => room.id === serviceId);
  return room ?true:false
}

const joinRoomHandler = (data, socket) => {
  const { identity, roomId, onlyAudio } = data;

  const newUser = {
    identity,
    id: uuidv4(),
    socketId: socket.id,
    roomId,
    onlyAudio,
  };


  const room = rooms.find((room) => room.id ==roomId);
  room.connectedUsers = [...room?.connectedUsers||[], newUser];

  socket.join(roomId);


  connectedUsers = [...connectedUsers, newUser];

 
  room.connectedUsers.forEach((user) => {
    console.log("🚀 ~ user ~ user:", user)

    if (user.socketId != socket.id) {
      const data = {
        connUserSocketId: socket.id,
      };
      console.log("🚀 ~ user ~ connUserSocketId:","data",data)

      io.to(user.socketId).emit("conn-prepare", data);
    }
  });

  io.to(roomId).emit("room-update", { connectedUsers: room.connectedUsers });
};

const disconnectHandler = (socket) => {

  const user = connectedUsers.find((user) => user.socketId === socket.id);

  if (user) {
  
    const room = rooms.find((room) => room.id === user.roomId);

    room.connectedUsers = room.connectedUsers.filter(
      (user) => user.socketId !== socket.id
    );

    
    socket.leave(user.roomId);

    
    if (room.connectedUsers.length > 0) {
    
      io.to(room.id).emit("user-disconnected", { socketId: socket.id });

      io.to(room.id).emit("room-update", {
        connectedUsers: room.connectedUsers,
      });
    } else {
      rooms = rooms.filter((r) => r.id !== room.id);
    }
  }
};

const signalingHandler = (data, socket) => {
  const { connUserSocketId, signal } = data;

  const signalingData = { signal, connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-signal", signalingData);
};


const initializeConnectionHandler = (data, socket) => {
  const { connUserSocketId } = data;

  const initData = { connUserSocketId: socket.id };
  io.to(connUserSocketId).emit("conn-init", initData);
};

const directMessageHandler = (data, socket) => {
  if (
    connectedUsers.find(
      (connUser) => connUser.socketId === data.receiverSocketId
    )
  ) {
    const receiverData = {
      authorSocketId: socket.id,
      messageContent: data.messageContent,
      isAuthor: false,
      identity: data.identity,
    };
    socket.to(data.receiverSocketId).emit("direct-message", receiverData);

    const authorData = {
      receiverSocketId: data.receiverSocketId,
      messageContent: data.messageContent,
      isAuthor: true,
      identity: data.identity,
    };

    socket.emit("direct-message", authorData);
  }
};

server.listen(PORT, () => {
  console.log(`Server is listening on ${PORT}`);
});
