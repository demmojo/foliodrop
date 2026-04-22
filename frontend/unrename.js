const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('src');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // React states and variables
  content = content.replace(/roomCode/g, 'sessionCode');
  content = content.replace(/setRoomCode/g, 'setSessionCode');
  content = content.replace(/RoomCode/g, 'SessionCode');
  
  content = content.replace(/activeRoomId/g, 'activeSessionId');
  content = content.replace(/urlRoomId/g, 'urlSessionId');
  content = content.replace(/setRoomId/g, 'setSessionId');
  content = content.replace(/roomId/g, 'sessionId');
  content = content.replace(/RoomId/g, 'SessionId');
  
  content = content.replace(/recentRooms/g, 'recentSessions');
  content = content.replace(/setRecentRooms/g, 'setRecentSessions');
  content = content.replace(/showAllRooms/g, 'showAllSessions');
  content = content.replace(/setShowAllRooms/g, 'setShowAllSessions');
  
  content = content.replace(/handleResumeRoom/g, 'handleResumeSession');
  content = content.replace(/rehydrateRoom/g, 'rehydrateSession');
  
  content = content.replace(/room-code-/g, 'session-code-');
  content = content.replace(/resume-room-/g, 'resume-session-');
  
  content = content.replace(/show-more-rooms/g, 'show-more-sessions');
  content = content.replace(/hdr_recent_rooms/g, 'hdr_recent_sessions');
  
  // Also any UI text that says "Session" but isn't part of an API call
  content = content.replace(/Room Code/g, 'Session Code');
  content = content.replace(/Enter Room Code/g, 'Enter Session Code');

  // other replacements
  content = content.replace(/room\.id/g, 'session.id');
  content = content.replace(/room\.date/g, 'session.date');
  content = content.replace(/room\.count/g, 'session.count');
  content = content.replace(/newRoom/g, 'newSession');
  content = content.replace(/pastRooms/g, 'pastSessions');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});

console.log('Done replacing room mentions.');
