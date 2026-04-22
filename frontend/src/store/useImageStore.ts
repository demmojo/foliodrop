import { create } from 'zustand';

interface RoomGroup {
  id: string;
  name: string;
  files: File[];
  status: 'pending' | 'processing' | 'auto-approved' | 'review-needed' | 'exported';
  confidenceScore?: number;
}

interface ImageParamsState {
  roomGroups: RoomGroup[];
  activeSessionId: string | null;
  addFileToGroup: (file: File, groupName: string) => void;
  updateGroupStatus: (groupId: string, status: RoomGroup['status']) => void;
  setActiveRoom: (groupId: string) => void;
}

export const useImageStore = create<ImageParamsState>((set) => ({
  roomGroups: [],
  activeSessionId: null,
  addFileToGroup: (file, groupName) => set((state) => {
    // Very basic auto-grouping simulation
    const existingGroup = state.roomGroups.find(g => g.name === groupName);
    if (existingGroup) {
      return {
        roomGroups: state.roomGroups.map(g => 
          g.name === groupName ? { ...g, files: [...g.files, file] } : g
        )
      };
    }
    return {
      roomGroups: [...state.roomGroups, {
        id: Math.random().toString(36).substr(2, 9),
        name: groupName,
        files: [file],
        status: 'pending'
      }]
    };
  }),
  updateGroupStatus: (groupId, status) => set((state) => ({
    roomGroups: state.roomGroups.map(g => 
      g.id === groupId ? { ...g, status } : g
    )
  })),
  setActiveRoom: (groupId) => set({ activeSessionId: groupId }),
}));
