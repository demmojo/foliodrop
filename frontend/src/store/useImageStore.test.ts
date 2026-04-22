import { describe, it, expect, beforeEach } from 'vitest';
import { useImageStore } from './useImageStore';

describe('useImageStore', () => {
  beforeEach(() => {
    // Reset state before each test
    useImageStore.setState({
      roomGroups: [],
      activeSessionId: null,
    });
  });

  it('should initialize with empty state', () => {
    const state = useImageStore.getState();
    expect(state.roomGroups).toEqual([]);
    expect(state.activeSessionId).toBeNull();
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

  it('should add a file to an existing group and leave other groups intact', () => {
    const file1 = new File([''], 'test1.jpg');
    const file2 = new File([''], 'test2.jpg');
    const file3 = new File([''], 'test3.jpg');
    
    useImageStore.getState().addFileToGroup(file1, 'Living Room');
    useImageStore.getState().addFileToGroup(file3, 'Kitchen');
    useImageStore.getState().addFileToGroup(file2, 'Living Room'); // This hits the true branch and the false branch for Kitchen

    const state = useImageStore.getState();
    expect(state.roomGroups).toHaveLength(2);
    
    const livingRoom = state.roomGroups.find(g => g.name === 'Living Room');
    expect(livingRoom?.files).toHaveLength(2);
    
    const kitchen = state.roomGroups.find(g => g.name === 'Kitchen');
    expect(kitchen?.files).toHaveLength(1);
  });

  it('should update group status and leave others intact', () => {
    const file = new File([''], 'test.jpg');
    const file2 = new File([''], 'test.jpg');
    useImageStore.getState().addFileToGroup(file, 'Living Room');
    useImageStore.getState().addFileToGroup(file2, 'Kitchen');
    
    const groupId = useImageStore.getState().roomGroups[0].id;
    useImageStore.getState().updateGroupStatus(groupId, 'processing'); // Hits the ternary

    const state = useImageStore.getState();
    expect(state.roomGroups[0].status).toBe('processing');
    expect(state.roomGroups[1].status).toBe('pending');
  });

  it('should set active room', () => {
    const file = new File([''], 'test.jpg');
    useImageStore.getState().addFileToGroup(file, 'Living Room');
    
    const groupId = useImageStore.getState().roomGroups[0].id;
    useImageStore.getState().setActiveRoom(groupId);

    const state = useImageStore.getState();
    expect(state.activeSessionId).toBe(groupId);
  });
});