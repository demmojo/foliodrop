const fs = require('fs');

const files = [
  'src/components/UploadFlow.tsx',
  'src/components/ProcessingConsole.tsx',
  'src/store/useJobStore.ts'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  content = content.replace(/Room Code/g, 'Session Code');
  content = content.replace(/Room code/g, 'Session code');
  content = content.replace(/room code/g, 'session code');
  
  content = content.replace(/Start a New Room/g, 'Start a New Session');
  content = content.replace(/Start a new room/g, 'Start a new session');
  content = content.replace(/Recent Rooms/g, 'Recent Sessions');
  content = content.replace(/more rooms/g, 'more sessions');
  
  content = content.replace(/previous room/g, 'previous session');
  content = content.replace(/new room/g, 'new session');
  content = content.replace(/expectedRooms/g, 'expectedScenes');
  content = content.replace(/estRooms/g, 'estScenes');
  
  content = content.replace(/roomName/g, 'sceneName');
  content = content.replace(/pendingRoomCode/g, 'pendingSessionCode');
  content = content.replace(/setPendingRoomCode/g, 'setPendingSessionCode');
  content = content.replace(/storedRoomCode/g, 'storedSessionCode');
  content = content.replace(/hdr_room_code/g, 'hdr_session_code');
  content = content.replace(/newRoom/g, 'newSession');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
