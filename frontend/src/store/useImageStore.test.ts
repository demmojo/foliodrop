import { describe, it, expect, beforeEach } from 'vitest';
import { useImageStore } from './useImageStore';

describe('useImageStore', () => {
  beforeEach(() => {
    // Reset state before each test
    useImageStore.setState({
      roomGroups: [],
      activeRoomId: null,
    });
  });

  it('should initialize with empty state', () => {
    const state = useImageStore.getState();
    expect(state.roomGroups).toEqual([]);
    expect(state.activeRoomId).toBeNull();
  });

  it('should add a file to a new group', () => {
    const file = new File([''], 'test.jpg');
    useImageStore.getState().addFileToGroup(file, 'Living Room');

    const state = useImageStore.getState();
    expect(state.roomGroups).toHaveLength(1);
    expect(state.roomGroups[0].name).toBe('Living Room');
    expect(state.roomGroups[0].files).toHaveLength(1);
    expect(state.roomGroups[0].files[0]).toBe(file);
    expect(state.roomGroups[0].status).toBe('pending');
    expect(state.roomGroups[0].id).toBeDefined();
  });

  it('should add a file to an existing group', () => {
    const file1 = new File([''], 'test1.jpg');
    const file2 = new File([''], 'test2.jpg');
    
    useImageStore.getState().addFileToGroup(file1, 'Living Room');
    useImageStore.getState().addFileToGroup(file2, 'Living Room');

    const state = useImageStore.getState();
    expect(state.roomGroups).toHaveLength(1);
    expect(state.roomGroups[0].name).toBe('Living Room');
    expect(state.roomGroups[0].files).toHaveLength(2);
    expect(state.roomGroups[0].files).toContain(file1);
    expect(state.roomGroups[0].files).toContain(file2);
  });

  it('should update group status', () => {
    const file = new File([''], 'test.jpg');
    useImageStore.getState().addFileToGroup(file, 'Living Room');
    
    const groupId = useImageStore.getState().roomGroups[0].id;
    useImageStore.getState().updateGroupStatus(groupId, 'processing');

    const state = useImageStore.getState();
    expect(state.roomGroups[0].status).toBe('processing');
  });

  it('should set active room', () => {
    const file = new File([''], 'test.jpg');
    useImageStore.getState().addFileToGroup(file, 'Living Room');
    
    const groupId = useImageStore.getState().roomGroups[0].id;
    useImageStore.getState().setActiveRoom(groupId);

    const state = useImageStore.getState();
    expect(state.activeRoomId).toBe(groupId);
  });
});