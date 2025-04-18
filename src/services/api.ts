// Function to check Hivewatchers blacklist
import axios from 'axios';

export const checkHivewatchers = async (): Promise<string[]> => {
    try {
      const response = await axios.get('https://spaminator.me/api/bl/all.json');
      if (response.data && Array.isArray(response.data.result)) {
        return response.data.result;
      }
      console.error('Unexpected response format from Hivewatchers API.');
      return [];
    } catch (error) {
      console.error('Hivewatchers API is offline or unreachable:', (error as Error).message);
      return []; // Ignore if the API is offline
    }
};

export async function checkHiveVoteTrail(author: string): Promise<boolean> {
    try {
      const response = await axios.get(`https://hive.vote/api.php?i=1&user=hive-br.voter`);
      const trailUsers = response.data.map((user: any) => user.follower); // Use "follower" field
      return trailUsers.includes(author);
    } catch (error) {
      console.error(`Error checking trail list for @${author}:`, error);
      return false;
    }
}