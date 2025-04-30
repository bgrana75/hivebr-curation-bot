import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const USERS_FILE = './users.json';
const BLACKLIST_FILE = './blacklist.json';
const STAFF_FILE = './staff.json';
const AUTO_FILE = './auto.json';

export const getStaffUsers = async (): Promise<{ hiveUsername: string; discordId: string }[]> => {
    try {
      const data = await readFile(STAFF_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Could not read users from ${STAFF_FILE}:`, (error as Error).message);
      return [];
    }
};
  
export const saveStaffUsers = async (users: { hiveUsername: string; discordId: string }[]): Promise<void> => {
  try {
    await writeFile(STAFF_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${STAFF_FILE}:`, (error as Error).message);
  }
};

// Helper function to check if a user is in the staff list
export async function isUserInStaffList(discordId: string): Promise<boolean> {
    const staffUsers = await getStaffUsers();
    return staffUsers.some(user => user.discordId === discordId);
  }

// Rename getUsersToMonitor to getVerifiedUsers
export const getVerifiedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${USERS_FILE}:`, (error as Error).message);
    return [];
  }
};

// Rename saveUsersToMonitor to saveVerifiedUsers
export const saveVerifiedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${USERS_FILE}:`, (error as Error).message);
  }
};

export const getBlacklistedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(BLACKLIST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${BLACKLIST_FILE}:`, (error as Error).message);
    return [];
  }
};

export const saveBlacklistedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(BLACKLIST_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${BLACKLIST_FILE}:`, (error as Error).message);
  }
};

export const getAutoUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(AUTO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${AUTO_FILE}:`, (error as Error).message);
    return [];
  }
};

export const saveAutoUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(AUTO_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${AUTO_FILE}:`, (error as Error).message);
  }
};

export const getLastProcessedBlock = async (filePath: string): Promise<number> => {
  try {
    const data = await readFile(filePath, 'utf-8');
    return parseInt(data, 10) || 0;
  } catch (error) {
    console.error(`Could not read last processed block from ${filePath}:`, (error as Error).message);
    return 0;
  }
};

export const updateLastProcessedBlock = async (filePath: string, blockNumber: number): Promise<void> => {
  try {
    await writeFile(filePath, blockNumber.toString());
  } catch (error) {
    console.error(`Could not write last processed block to ${filePath}:`, (error as Error).message);
  }
};