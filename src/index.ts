import { config } from 'dotenv';
import { Client as DiscordClient, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Client as HiveClient, VoteOperation } from '@hiveio/dhive';
import { hiveEngineApi } from './hive_engine';
import * as fs from 'fs';
import { promisify } from 'util';
import axios from 'axios';
import { vote } from './hive/index';
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

config(); // Load .env variables

const USERS_FILE = './users.json';
const BLACKLIST_FILE = './blacklist.json';
const STAFF_FILE = './staff.json';

const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
  'https://anyx.io',
  'https://techcoderx.com'
];
let currentNodeIndex = 0;
let currentNode: HiveClient;

let stream: any;

// Global variable to store the active channel
let activeChannel: any = null;

const getStaffUsers = async (): Promise<{ hiveUsername: string; discordId: string }[]> => {
  try {
    const data = await readFile(STAFF_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${STAFF_FILE}:`, (error as Error).message);
    return [];
  }
};

const saveStaffUsers = async (users: { hiveUsername: string; discordId: string }[]): Promise<void> => {
  try {
    await writeFile(STAFF_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${STAFF_FILE}:`, (error as Error).message);
  }
};

// Rename getUsersToMonitor to getVerifiedUsers
const getVerifiedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${USERS_FILE}:`, (error as Error).message);
    return [];
  }
};

// Rename saveUsersToMonitor to saveVerifiedUsers
const saveVerifiedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${USERS_FILE}:`, (error as Error).message);
  }
};

const getBlacklistedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(BLACKLIST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${BLACKLIST_FILE}:`, (error as Error).message);
    return [];
  }
};

const saveBlacklistedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(BLACKLIST_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${BLACKLIST_FILE}:`, (error as Error).message);
  }
};

const getLastProcessedBlock = async (filePath: string): Promise<number> => {
  try {
    const data = await readFile(filePath, 'utf-8');
    return parseInt(data, 10) || 0;
  } catch (error) {
    console.error(`Could not read last processed block from ${filePath}:`, (error as Error).message);
    return 0;
  }
};

const updateLastProcessedBlock = async (filePath: string, blockNumber: number): Promise<void> => {
  try {
    await writeFile(filePath, blockNumber.toString());
  } catch (error) {
    console.error(`Could not write last processed block to ${filePath}:`, (error as Error).message);
  }
};

const getNextHiveClient = () => {
  currentNodeIndex = (currentNodeIndex + 1) % HIVE_NODES.length;
  console.log(`Switching to Hive node: ${HIVE_NODES[currentNodeIndex]}`);
  currentNode = new HiveClient(HIVE_NODES[currentNodeIndex]);
  return currentNode;
};

const getHiveClient = () => {
  if (!currentNode) {
    return getNextHiveClient();
  }
  return currentNode;
}

async function convertVestToHive (amount: number) {
  const hiveClient = getHiveClient();
  const globalProperties = await hiveClient.call('condenser_api', 'get_dynamic_global_properties', []);
  const totalVestingFund = extractNumber(globalProperties.total_vesting_fund_hive)
  const totalVestingShares = extractNumber(globalProperties.total_vesting_shares)
  const vestHive = ( totalVestingFund * amount ) / totalVestingShares
  return vestHive
}

function extractNumber(value: string): number {

  const match = value.match(/([\d.]+)/);
  return match ? parseFloat(match[0]) : 0;
}

function hasHiveBrTag(jsonMetadata: string): boolean {
  try {
    const metadata = JSON.parse(jsonMetadata);
    return Array.isArray(metadata.tags) && metadata.tags.includes('hivebr');
  } catch (error) {
    console.error('Error parsing json_metadata:', error);
    return false;
  }
}

async function getHiveBrVoterDelegation(author: string): Promise<number | null> {
  const hiveClient = getHiveClient();
  try {
    const delegations = await hiveClient.database.getVestingDelegations(author);

    const delegation = delegations.find(d => d.delegatee === 'hive-br.voter');
    
    if (delegation) {
      return convertVestToHive(extractNumber(String(delegation.vesting_shares)));
    } else {
      return 0; // No delegation to 'hive-br.voter' found
    }
  } catch (error) {
    console.error(`Error fetching delegations for @${author}:`, error);
    return null;
  }
}

type IncomingDelegation = {
  delegator: string;
  delegatee: string;
  vests: string; // e.g., "178701.319083"
  hp_equivalent: string; // e.g., "106.457"
  timestamp: string; // ISO string
};

async function getAuthorDelegationRank(author: string): Promise<number | null> {
  const communityAccount = 'hive-br.voter';
  const url = `https://hafsql-api.mahdiyari.info/delegations/${communityAccount}/incoming`;

  try {
    const response = await axios.get<IncomingDelegation[]>(url);
    const delegations = response.data;
    const rankedDelegators = delegations
      .map((d) => ({
        delegator: d.delegator,
        amount: parseFloat(d.vests),
      }))
      .sort((a, b) => b.amount - a.amount);

    const authorRank = rankedDelegators.findIndex((d) => d.delegator === author);

    return authorRank !== -1 ? authorRank + 1 : null;
  } catch (error) {
    console.error(`Error fetching delegation rank for @${author}:`, error);
    return null;
  }
}

async function checkSameDayVote(
  author: string,
  permlink: string,
  referenceDate: Date
): Promise<boolean> {
  const hiveClient = getHiveClient();

  try {
    const posts = await hiveClient.database.call('get_discussions_by_author_before_date', [
      author,
      permlink,
      '',
      10
    ]);

    for (const post of posts) {
      // Skip the original post in question
      if (post.permlink === permlink) continue;

      const postDate = new Date(post.created);

      const sameDay =
        postDate.getUTCFullYear() === referenceDate.getUTCFullYear() &&
        postDate.getUTCMonth() === referenceDate.getUTCMonth() &&
        postDate.getUTCDate() === referenceDate.getUTCDate();

      if (sameDay) {
        const hasVote = post.active_votes.some((vote: any) => vote.voter === 'hive-br.voter');
        if (hasVote) return true;
      } else if (postDate < referenceDate) {
        // Posts are ordered, no need to continue if date is earlier
        break;
      }
    }

    return false;
  } catch (error) {
    console.error(`Error checking same-day vote for @${author}:`, error);
    return false;
  }
}

async function getUserInfo(author: string): Promise<{
  hive: number;
  hbd: number;
  hbdSaving: number;
  hp: number;
  delegatedHp: number;
  receivedHp: number;
  ke: number;
  isPD: number;
  vestingShares: number;
  delegatedVestingShares: number;
  hiveBrVoterDelegation: number | null;
  hbrInfo: any;
} | null> {
  const hiveClient = getHiveClient();
  try {
    const [accountData] = await hiveClient.database.getAccounts([author]);
    if (accountData) {
      const hive = extractNumber(String(accountData.balance));
      const hbd = extractNumber(String(accountData.hbd_balance));
      const hbdSaving = extractNumber(String(accountData.savings_hbd_balance));
      const hp = await convertVestToHive(extractNumber(String(accountData.vesting_shares)));
      const delegatedHp = await convertVestToHive(extractNumber(String(accountData.delegated_vesting_shares)));
      const receivedHp = await convertVestToHive(extractNumber(String(accountData.received_vesting_shares)));
      const ke = ((Number(accountData.curation_rewards) + Number(accountData.posting_rewards)) / 1000) / hp;
      const hiveBrVoterDelegation = await getHiveBrVoterDelegation(author);
      const pdRate = extractNumber(String(accountData.vesting_withdraw_rate));
      const isPD = pdRate > 0 ? 1 : 0;
      const hbrInfo = await hiveEngineApi.getAccountTokensBalances( author, 'HBR' );

      return {
        hive,
        hbd,
        hbdSaving,
        hp,
        delegatedHp,
        receivedHp,
        ke,
        isPD,
        vestingShares: extractNumber(String(accountData.vesting_shares)),
        delegatedVestingShares: extractNumber(String(accountData.delegated_vesting_shares)),
        hiveBrVoterDelegation,
        hbrInfo
      };
    } else {
      console.log(`No account data found for @${author}`);
      return null;
    }
  } catch (error) {
    console.error(`Failed to fetch wallet info for @${author}:`, error);
    return null;
  }
}

async function getPostInfo(author: string, permlink: string): Promise<{
  category: string;
  title: string;
  body: string;
  parentAuthor: string;
  parentPermlink: string;
  created: string;
  lastUpdate: string;
  beneficiaries: any[];
  activeVotes: any[];
  isDeclining: number;
} | null> {
  const hiveClient = getHiveClient();
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const content = await hiveClient.database.call('get_content', [author, permlink]);
      const { category, title, body, parent_author, parent_permlink, created, lastUpdate, active_votes, beneficiaries, max_accepted_payout } = content;

      const maxAcceptedPayoutValue = extractNumber(max_accepted_payout);
      const isDeclining = maxAcceptedPayoutValue > 0 ? 0 : 1;

      return {
        category,
        title,
        body,
        parentAuthor: parent_author,
        parentPermlink: parent_permlink,
        created,
        lastUpdate,
        beneficiaries,
        activeVotes: active_votes,
        isDeclining
      };
    } catch (error) {
      console.error(`Attempt ${attempt} failed to fetch post @${author}/${permlink}:`, error);

      if (attempt < maxRetries) {
        console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error(`Failed to fetch post @${author}/${permlink} after ${maxRetries} attempts.`);
        return null;
      }
    }
  }

  return null;
}

// Function to check Hivewatchers blacklist
const checkHivewatchers = async (): Promise<string[]> => {
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

// Modify processPost to use the API for trail list check
const processPost = async (post: any, timestamp: string) => {
  const { author, permlink, json_metadata } = post;
  const postLnk = `https://peakd.com/@${author}/${permlink}`;

  // Parse json_metadata to check for the "hivebrphotocontest" tag
  try {
    const metadata = JSON.parse(json_metadata);
    if (Array.isArray(metadata.tags) && metadata.tags.includes('hivebrphotocontest')) {
      console.error(`Skipping post by @${author} because it is tagged with "hivebrphotocontest".`);
      if (activeChannel) {
        await activeChannel.send(`Skipping post <${postLnk}> by @${author}: Post is tagged with "hivebrphotocontest".`);
      }
      return;
    }
  } catch (error) {
    console.error('Error parsing json_metadata:', error);
  }

  const postInfo = await getPostInfo(author, permlink);
  if (!postInfo) {
    console.error(`Failed to fetch post info for @${author}/${permlink}`);
    if (activeChannel) {
      await activeChannel.send(`Skipping post <${postLnk}> by @${author}: Failed to fetch post info.`);
    }
    return;
  }

  // Check if the user is on the blacklist or Hivewatchers list
  const blacklistedUsers = await getBlacklistedUsers();
  const hivewatchersList = await checkHivewatchers();
  if (blacklistedUsers.includes(author) || hivewatchersList.includes(author)) {
    console.error(`Skipping post by blacklisted user @${author}`);
    if (activeChannel) {
      await activeChannel.send(`Skipping post <${postLnk}> by @${author}: User is blacklisted.`);
    }
    return;
  }

  // Check if the author was already voted on the same day
  const referenceDate = new Date(timestamp);
  const alreadyVoted = await checkSameDayVote(author, permlink, referenceDate);
  if (alreadyVoted) {
    console.error(`Skipping post by @${author} because they were already voted on the same day.`);
    if (activeChannel) {
      await activeChannel.send(`Skipping post <${postLnk}> by @${author}: Already voted on the same day.`);
    }
    return;
  }

  const postCreatedTime = new Date(postInfo.created).getTime();
  const providedTimestamp = new Date(timestamp).getTime();
  console.log(`Post created time: ${postCreatedTime}, Provided timestamp: ${providedTimestamp}`);
  // Allow up to 5 seconds difference
  if (providedTimestamp < postCreatedTime || providedTimestamp > postCreatedTime + 5000) {
    console.error(`Post @${author}/${permlink} was created outside the allowed timestamp range. Skipping.`);
    // if (activeChannel) {
    //   await activeChannel.send(`Skipping post <${postLnk}> by @${author}: This is a post edit, not a new post.`);
    // }
    return;
  }

  const { category, title, body, beneficiaries, isDeclining } = postInfo;
  const userInfo = await getUserInfo(author);
  const postLink = `https://peakd.com/@${author}/${permlink}`;
  
  if (userInfo) {
    // Initialize voteValue
    let voteValue = 0;

    // Calculate voteValue based on KE
    let kePoints = 0;
    if (userInfo.ke < 1.5) {
      kePoints = 10;
    } else if (userInfo.ke >= 1.5 && userInfo.ke < 3) {
      kePoints = 5;
    }
    voteValue += kePoints;

    // Calculate Percentage Delegated
    const adjustedDelegatedHp = userInfo.delegatedHp - (userInfo.hiveBrVoterDelegation || 0);
    const percentageDelegated = (adjustedDelegatedHp / userInfo.hp) * 100;

    // Calculate voteValue based on Percentage Delegated
    let delegationPoints = 0;
    if (percentageDelegated < 30) {
      delegationPoints = 10;
    } else if (percentageDelegated >= 30 && percentageDelegated < 50) {
      delegationPoints = 5;
    }
    voteValue += delegationPoints;

    // Add points if user is not powering down
    let pdPoints = 0;
    if (!userInfo.isPD) {
      pdPoints = 20;
      voteValue += pdPoints;
    }

    // Get author ranking among delegators
    const authorRank = await getAuthorDelegationRank(author);
    let rankPoints = 0;
    if (authorRank !== null) {
      if (authorRank >= 1 && authorRank <= 10) {
        rankPoints = 20;
      } else if (authorRank >= 11 && authorRank <= 20) {
        rankPoints = 15;
      } else if (authorRank >= 21 && authorRank <= 30) {
        rankPoints = 10;
      } else if (authorRank >= 31 && authorRank <= 40) {
        rankPoints = 5;
      }
      voteValue += rankPoints;
    }

    // Calculate points based on HBR Stake
    let hbrPoints = 0;
    if (userInfo.hbrInfo?.stake) {
      hbrPoints = Math.min(Math.floor(userInfo.hbrInfo.stake / 10), 20); // 1 point per 10 HBR, max 20 points
      voteValue += hbrPoints;
    }

    // Check if the user is verified
    const verifiedUsers = await getVerifiedUsers();
    let verifiedPoints = 0;
    const isVerified = verifiedUsers.includes(author);
    if (isVerified) {
      verifiedPoints = 10;
      voteValue += verifiedPoints;
    }

    // Check if the post was made in the HiveBR community
    let postedInHiveBR = false;
    let hiveBRPoints = 0;
    try {
      if (category === 'hive-127515') {
        postedInHiveBR = true;
        hiveBRPoints = 5; // Add 5 points if posted in HiveBR
        voteValue += hiveBRPoints;
      }
    } catch (error) {
      console.error('Error parsing json_metadata:', error);
    }

    // Check if "hive-br" is one of the beneficiaries with a minimum weight of 500
    let hiveBrBeneficiary = false;
    let hiveBrBeneficiaryPoints = 0;
    if (Array.isArray(beneficiaries)) {
      hiveBrBeneficiary = beneficiaries.some(b => b.account === 'hive-br' && b.weight >= 500);
      if (hiveBrBeneficiary) {
        hiveBrBeneficiaryPoints = 5; // Add 5 points if the condition is met
        voteValue += hiveBrBeneficiaryPoints;
      }
    }

    // Check if the user is on the trail list using the API
    let trailPoints = 0;
    try {
      const response = await axios.get(`https://hive.vote/api.php?i=1&user=hive-br.voter`);
      const trailUsers = response.data.map((user: any) => user.follower); // Use "follower" field
      if (trailUsers.includes(author)) {
        trailPoints = 5; // Add 5 points if the user is on the trail list
        voteValue += trailPoints;
      }
    } catch (error) {
      console.error(`Error checking trail list for @${author}:`, error);
    }

    // Check if the user is in the stafflist
    const staffUsers = await getStaffUsers();
    let staffPoints = 0;
    const isInStaffList = staffUsers.includes(author);
    if (isInStaffList) {
      staffPoints = 10; // Add 10 points if the user is in the stafflist
      voteValue += staffPoints;
    }

    // Ensure total points do not exceed 100
    voteValue = Math.min(voteValue, 100);

    if (author === 'hive-br') {
      voteValue = 100;
    }

    // Extract the first image from the body (Markdown text)
    let thumbnailUrl: string | null = null;
    const imageRegex = /!\[.*?\]\((.*?)\)/;
    const match = body.match(imageRegex);
    if (match && match[1]) {
      thumbnailUrl = match[1]; // Use the first image URL as the thumbnail
    }

    // Validate fields to ensure no undefined values
    const safeTitle = title || 'Untitled';
    const safeBeneficiaries = beneficiaries ? `\`\`\`json\n${JSON.stringify(beneficiaries, null, 2)}\n\`\`\`` : 'None';
    const safeIsDeclining = isDeclining !== undefined ? (isDeclining ? 'Yes' : 'No') : 'Unknown';

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x0099ff) // Blue color
      .setAuthor({ name: `@${author}`, iconURL: `https://images.hive.blog/u/${author}/avatar`, url: `https://peakd.com/@${author}` })
      .setTitle(`**${safeTitle}**`) 
      .setURL(postLink);

    // Set thumbnail if available
    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }

    embed.addFields(
      { name: '**Boas Práticas Hive:**', value: '', inline: false },
      //{ name: '**HP:**', value: `${userInfo.hp?.toFixed(3) || 'N/A'}`, inline: true },
      { name: '**KE:**', value: `${userInfo.ke?.toFixed(3) || 'N/A'} (+${kePoints}%)`, inline: false },
      { name: '**Percentage Delegated:**', value: `${percentageDelegated.toFixed(2)}% (+${delegationPoints}%)`, inline: false },
      { name: '**Power Down:**', value: `${userInfo.isPD ? 'Yes' : 'No'} (+${pdPoints}%)`, inline: false },
      { name: '**Apoio na Comunidade HiveBR:**', value: '', inline: false },
      { name: '**Hive-BR Delegation:**', value: `${userInfo.hiveBrVoterDelegation?.toFixed(3) || 'N/A'}`, inline: true },
      { name: '**Ranking:**', value: `${authorRank !== null ? `#${authorRank} (+${rankPoints}%)` : 'Not Ranked'}`, inline: true },
      { name: '**HBR Stake:**', value: `${userInfo.hbrInfo?.stake?.toString() || 'N/A'} (+${hbrPoints}%)`, inline: false },
      { name: '**Verified User:**', value: `${isVerified ? 'Yes' : 'No'} (+${verifiedPoints}%)`, inline: false },
      { name: '**Posted in HiveBR:**', value: `${postedInHiveBR ? 'Yes' : 'No'} (+${hiveBRPoints}%)`, inline: false },
      { name: '**Hive-BR Beneficiary:**', value: `${hiveBrBeneficiary ? 'Yes' : 'No'} (+${hiveBrBeneficiaryPoints}%)`, inline: false },
      { name: '**In Trail List:**', value: `${trailPoints > 0 ? 'Yes' : 'No'} (+${trailPoints}%)`, inline: false },
      { name: '**In Staff List:**', value: `${isInStaffList ? 'Yes' : 'No'} (+${staffPoints}%)`, inline: false },
      { name: '**Total Vote:**', value: `${voteValue}%`, inline: false }
    );

    // Create buttons
    const voteButton = new ButtonBuilder()
      .setCustomId(`${author}/${permlink}/${voteValue}`) // Include voteValue in customId
      .setLabel(' 🚀 VOTE! ')
      .setStyle(ButtonStyle.Primary);
  
    const viewPostButton = new ButtonBuilder()
      .setLabel('View Post')
      .setStyle(ButtonStyle.Link)
      .setURL(postLink);
    
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(voteButton, viewPostButton);

    return { embed, buttons };
  }

  return null;
};

async function processBlock(block: any): Promise<void> {
  let blockNum = 0;

  for (const transaction of block.transactions) {
    blockNum = transaction.block_num;

    if (transaction.operations[0][0] === 'comment' && transaction.operations[0][1].parent_author === '') {
      const postData = transaction.operations[0][1];
      const { json_metadata, author } = postData;

      try {
        const metadata = JSON.parse(json_metadata);
        if (Array.isArray(metadata.tags) && (metadata.tags.includes('hivebr') || metadata.tags.includes('hive-br'))) {
          const blacklistedUsers = await getBlacklistedUsers();
          if (!blacklistedUsers.includes(author)) {
            const result = await processPost(postData, block.timestamp);

            if (result && activeChannel) {
              const { embed, buttons } = result;
              await activeChannel.send({ embeds: [embed], components: [buttons] });
            }
          } else {
            console.log(`Author @${author} is blacklisted. Skipping post.`);
          }
        }
      } catch (error) {
        console.error('Error parsing json_metadata or checking tags:', error);
      }
    }
  }

  //console.log(`Block ${blockNum} processed.`);
  await updateLastProcessedBlock(process.env.BLOCK_FILE || '', blockNum);
}

const streamBlockchain = async (retryCount = 0) => {
  const MAX_RETRIES = HIVE_NODES.length;
  const lastProcessedBlock = await getLastProcessedBlock(process.env.BLOCK_FILE || '');
  let hiveClient = getNextHiveClient();

  if (stream) {
    stream.removeAllListeners();
  }

  try {
    if (lastProcessedBlock) {
      console.log(`Resuming from block ${lastProcessedBlock + 1}`);
      stream = hiveClient.blockchain.getBlockStream({ from: lastProcessedBlock + 1 });
    } else {
      console.log('Starting from the latest block');
      stream = hiveClient.blockchain.getBlockStream();
    }
  } catch (error) {
    console.error(`Failed to start block stream: ${(error as Error).message}`);
    if (retryCount < MAX_RETRIES) {
      console.log('Trying next Hive node...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return streamBlockchain(retryCount + 1); // try next node
    } else {
      console.error('All Hive nodes failed. Exiting...');
      process.exit(1); // or handle differently
    }
  }

  stream.on('data', async (block: any) => {
    try {
      await processBlock(block);
    } catch (error) {
      console.error('Error processing block:', error);
    }
  });

  stream.on('error', async (error: Error) => {
    console.error('Error in block stream:', error);
    console.log('Attempting to restart the stream in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await streamBlockchain();
  });

  stream.on('end', async () => {
    console.log('Stream ended unexpectedly. Attempting to restart...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await streamBlockchain();
  });
};


const discordClient = new DiscordClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

discordClient.once('ready', async () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);
  //streamBlockchain();
});

discordClient.on('messageCreate', async (message) => {
  if (message.content === '!help') {
    const helpMessage = `
\`\`\`
Available Commands:

1. !start
   - Starts the blockchain stream and begins monitoring posts.

2. !stop
   - Stops the blockchain stream.

3. !verify <username>
   - Adds a user to the verified list.

4. !unverify <username>
   - Removes a user from the verified list.

5. !verified
   - Lists all verified users.

6. !ban <username>
   - Adds a user to the blacklist.

7. !unban <username>
   - Removes a user from the blacklist.

8. !blacklist
    - Lists all blacklisted users.

9. !staff <username> <discordmention>
    - Adds a user to the staff list.

10. !unstaff <username>
    - Removes a user from the staff list.

11. !stafflist
    - Lists all users in the staff list.

12. !userinfo <username>
   - Displays detailed information about a user's Hive account.

\`\`\`
    `;
    message.channel.send(helpMessage);
  }

  if (message.content.startsWith('!verify ')) {
    const userToAdd = message.content.split(' ')[1];
    if (userToAdd) {
      const blacklistedUsers = await getBlacklistedUsers();
      if (blacklistedUsers.includes(userToAdd)) {
        message.channel.send(`\`\`\`User @${userToAdd} is currently blacklisted. Please remove them from the blacklist first using !unban @${userToAdd}.\`\`\``);
        return;
      }
      const users = await getVerifiedUsers();
      if (!users.includes(userToAdd)) {
        users.push(userToAdd);
        await saveVerifiedUsers(users);
        message.channel.send(`\`\`\`User @${userToAdd} added to verified list.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${userToAdd} is already in the verified list.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify a user to add.\n```');
    }
  } else if (message.content.startsWith('!unverify ')) {
    const userToDelete = message.content.split(' ')[1];
    if (userToDelete) {
      let users = await getVerifiedUsers();
      if (users.includes(userToDelete)) {
        users = users.filter(user => user !== userToDelete);
        await saveVerifiedUsers(users);
        message.channel.send(`\`\`\`User @${userToDelete} removed from verified list.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${userToDelete} is not in the verified list.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify a user to delete.\n```');
    }
  } else if (message.content === '!verified') {
    const users = await getVerifiedUsers();
    if (users.length > 0) {
      const userList = users.sort().map(user => `- @${user}`).join('\n');
      message.channel.send(`\`\`\`**Verified Users:**\n${userList}\`\`\``);
    } else {
      message.channel.send('```\nNo users are currently verified.\n```');
    }
  } else if (message.content.startsWith('!userinfo ')) {
    const userToGet = message.content.split(' ')[1];
    if (userToGet) {
      let totalVote = 0;
      const userInfo = await getUserInfo(userToGet);
      
      if (userInfo) {
        const percentageDelegated = (userInfo.delegatedVestingShares / userInfo.vestingShares) * 100;
  
        const keColor = userInfo.ke < 1.5 ? '🟢' : userInfo.ke < 3 ? '🟡' : '🔴';
        const pdColor = userInfo.isPD ? '🔴' : '🟢';
        const percentageDelegatedColor = percentageDelegated < 30 ? '🟢' : percentageDelegated < 60 ? '🟡' : '🔴';
  
        const embed = {
          color: 0x0099ff, // Blue color
          title: `User Info for @${userToGet}`,
          thumbnail: { url: `https://images.hive.blog/u/${userToGet}/avatar` },
          fields: [
            { name: 'HP', value: `${userInfo.hp.toFixed(3)}`, inline: false },
            { name: 'KE', value: `${userInfo.ke.toFixed(3)} ${keColor}`, inline: false },
            { name: 'Power Down', value: `${userInfo.isPD ? 'Yes' : 'No'} ${pdColor}`, inline: false },
            { name: 'Percentage Delegated', value: `${percentageDelegated.toFixed(2)}% ${percentageDelegatedColor}`, inline: false },
            { name: 'Hive-BR Delegation', value: userInfo.hiveBrVoterDelegation ? `${userInfo.hiveBrVoterDelegation.toFixed(3)}` : 'N/A', inline: false },
            { name: 'HBR Stake', value: userInfo.hbrInfo ? userInfo.hbrInfo.stake.toString() : 'N/A', inline: false },
          ],
          footer: { text: `Requested by ${message.author.displayName}`, icon_url: message.author.displayAvatarURL() }
        };
  
        message.channel.send({ embeds: [embed] }); // Sends the message normally in the channel
      } else {
        message.channel.send(`No account data found for @${userToGet}`);
      }
    } else {
      message.channel.send('Please specify a user to get info.');
    }
  } else if (message.content.startsWith('!checkpost ')) {
    const input = message.content.split(' ')[1];
    if (input) {
        const [author, permlink] = input.replace('@', '').split('/');
        if (author && permlink) {
            const postInfo = await getPostInfo(author, permlink);
            if (postInfo) {
                const userInfo = await getUserInfo(author);
                if (userInfo) {
                  const { category, title, body, beneficiaries, isDeclining } = postInfo;
                  const wordCount = body.split(/\s+/).length;
                  const imageCount = (body.match(/!\[.*?\]\(.*?\)/g) || []).length;
                  const postLink = `https://peakd.com/@${author}/${permlink}`;
    
                  // Embed with user and post sections
                  const embed = new EmbedBuilder()
                      .setColor(0x0099ff) // Blue color
                      .setAuthor({ name: `@${author}`, iconURL: `https://images.hive.blog/u/${author}/avatar`, url: `https://peakd.com/@${author}` }) // Post author
                      .setTitle(`**${title}**`) // Post title
                      .setURL(postLink) // Clickable post link
                      .addFields(
                          // Post info section
                          { name: '**Post Info:**', value: ``, inline:  true },
                          { name: ``, value: ``, inline:  false },
                          { name: "**Category**", value: category, inline: true },
                          { name: "**Declining Rewards**", value: isDeclining ? "Yes" : "No", inline: true },
                          { name: "", value: ``, inline:  false },
                          { name: "**Word Count**", value: `${wordCount}`, inline:  true },
                          { name: "**Image Count**", value: `${imageCount}`, inline: true },

                          { name: "**Beneficiaries**", value: `\`\`\`json\n${JSON.stringify(beneficiaries, null, 2)}\n\`\`\``, inline: false },

                          // User info section
                          { name: '**Author Info:**', value: ``, inline: false },
                          { name: `**HP:**`, value: `${userInfo.hp.toFixed(3)}`, inline: true },
                          { name: `**KE:**`, value: `${userInfo.ke.toFixed(3)}`, inline: true },
                          { name: ``, value: ``, inline:  false },
                          { name: `**Power Down:**`, value: `${userInfo.isPD ? 'Yes' : 'No'}`, inline: true },
                          { name: `**Hive-BR Delegation:**`, value: `${userInfo.hiveBrVoterDelegation ? userInfo.hiveBrVoterDelegation.toFixed(3) : 'N/A'}`, inline: true },
                          { name: ``, value: ``, inline:  false },
                          { name: `**HBR Stake:**`, value: `${userInfo.hbrInfo ? userInfo.hbrInfo.stake.toString() : 'N/A'}`, inline: true }
                      )
                      //.setFooter({ text: `Requested by ${message.author.displayName}`, iconURL: message.author.displayAvatarURL() });
    
                  // Buttons for actions
                  const buttons = new ActionRowBuilder<ButtonBuilder>()
                      .addComponents(
                          new ButtonBuilder()
                              .setCustomId(permlink)
                              .setLabel(' 🚀 VOTE! ')
                              .setStyle(ButtonStyle.Primary),
                          new ButtonBuilder()
                              .setLabel('View Post')
                              .setStyle(ButtonStyle.Link)
                              .setURL(postLink)
                      );
    
                  message.channel.send({ embeds: [embed], components: [buttons] });
                };
            } else {
                message.channel.send(`No post found for **@${author}/${permlink}**`);
            }
        } else {
            message.channel.send('Invalid format. Usage: `!checkpost @<author>/<permlink>`');
        }
    } else {
        message.channel.send('Please specify an author and permlink. Usage: `!checkpost @<author>/<permlink>`');
    }

  } else if (message.content.startsWith('!ban ')) {
    const userToBan = message.content.split(' ')[1];
    if (userToBan) {
      const users = await getVerifiedUsers();
      if (users.includes(userToBan)) {
        message.channel.send(`\`\`\`User @${userToBan} is currently in the monitoring list. Please remove them from the monitoring list first using !unverify @${userToBan}.\`\`\``);
        return;
      }
      const blacklistedUsers = await getBlacklistedUsers();
      if (!blacklistedUsers.includes(userToBan)) {
        blacklistedUsers.push(userToBan);
        await saveBlacklistedUsers(blacklistedUsers);
        message.channel.send(`\`\`\`User @${userToBan} has been banned and added to the blacklist.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${userToBan} is already in the blacklist.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify a user to ban.\n```');
    }
  } else if (message.content.startsWith('!unban ')) {
    const userToUnban = message.content.split(' ')[1];
    if (userToUnban) {
      let blacklistedUsers = await getBlacklistedUsers();
      if (blacklistedUsers.includes(userToUnban)) {
        blacklistedUsers = blacklistedUsers.filter(user => user !== userToUnban);
        await saveBlacklistedUsers(blacklistedUsers);
        message.channel.send(`\`\`\`User @${userToUnban} has been removed from the blacklist.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${userToUnban} is not in the blacklist.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify a user to unban.\n```');
    }
  } else if (message.content === '!blacklist') {
    const blacklistedUsers = await getBlacklistedUsers();
    if (blacklistedUsers.length > 0) {
      const userList = blacklistedUsers.sort().map(user => `- @${user}`).join('\n');
      message.channel.send(`\`\`\`**Blacklisted Users:**\n${userList}\`\`\``);
    } else {
      message.channel.send('```\nNo users are currently blacklisted.\n```');
    }
  } else if (message.content === '!start') {
    activeChannel = message.channel; // Store the channel globally
    message.channel.send('```\nStarting blockchain stream...\n```');
    await streamBlockchain();
  } else if (message.content === '!stop') {
    if (stream) {
      stream.removeAllListeners();
      stream = null;
      activeChannel = null; // Clear the active channel
      message.channel.send('```\nBlockchain stream stopped.\n```');
    } else {
      message.channel.send('```\nNo active blockchain stream to stop.\n```');
    }
  }

  // Staff commands
  if (message.content.startsWith('!staff ')) {
    const args = message.content.split(' ');
    const hiveUsername = args[1];
    const discordMention = args[2];

    if (hiveUsername && discordMention) {
      // Extract Discord ID from mention
      const discordId = discordMention.match(/^<@!?(\d+)>$/)?.[1];
      if (!discordId) {
        message.channel.send('```\nInvalid Discord mention. Please use the format: !staff <hiveusername> <@discorduser>\n```');
        return;
      }

      const staffUsers = await getStaffUsers();
      const existingEntry = staffUsers.find(user => user.hiveUsername === hiveUsername);

      if (!existingEntry) {
        staffUsers.push({ hiveUsername, discordId });
        await saveStaffUsers(staffUsers);
        message.channel.send(`\`\`\`User @${hiveUsername} (Discord ID: ${discordMention}) added to staff list.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${hiveUsername} is already in the staff list.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify both a Hive username and a Discord mention. Usage: !staff <hiveusername> <@discorduser>\n```');
    }
  } else if (message.content.startsWith('!unstaff ')) {
    const hiveUsername = message.content.split(' ')[1];
    if (hiveUsername) {
      let staffUsers = await getStaffUsers();
      if (staffUsers.some(user => user.hiveUsername === hiveUsername)) {
        staffUsers = staffUsers.filter(user => user.hiveUsername !== hiveUsername);
        await saveStaffUsers(staffUsers);
        message.channel.send(`\`\`\`User @${hiveUsername} removed from staff list.\`\`\``);
      } else {
        message.channel.send(`\`\`\`User @${hiveUsername} is not in the staff list.\`\`\``);
      }
    } else {
      message.channel.send('```\nPlease specify a Hive username to remove from the staff list.\n```');
    }
  } else if (message.content === '!stafflist') {
    const staffUsers = await getStaffUsers();
    if (staffUsers.length > 0) {
      const userList = staffUsers
        .sort((a, b) => a.hiveUsername.localeCompare(b.hiveUsername))
        .map(user => `- ${user.hiveUsername} - <@${user.discordId}>`)
        .join('\n');
      message.channel.send(`\`\`\`**Staff Users:**\n${userList}\`\`\``);
    } else {
      message.channel.send('```\nNo users are currently in the staff list.\n```');
    }
  } else if (message.content.startsWith('!test ')) {
    //const author = message.content.split(' ')[1];
    //const ranking = await getAuthorDelegationRank(author);
    //message.reply(ranking ? `User @${author} is ranked #${ranking} among delegators.` : `User @${author} is not ranked.`);
    message.channel.send('```\nThis is a Test.\n```');
  }
});

discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId } = interaction;

  if (customId) {
    try {
      const [author, permlink, voteValue] = customId.split('/');
      const privateKey = process.env.HIVE_PRIVATE_KEY; // Ensure this is set in your .env file
      const voter = process.env.HIVE_ACCOUNT; // Ensure this is set in your .env file

      if (!privateKey || !voter) {
        console.error('HIVE_PRIVATE_KEY or HIVE_ACCOUNT is not set in the environment variables.');
        await interaction.reply({ content: 'Voting is not configured properly. Please contact the administrator.', flags: 64 });
        return;
      }

      // Correctly construct the VoteOperation object
      const voteOperation: VoteOperation = [
        'vote',
        {
          voter,
          author,
          permlink,
          weight: Math.round(Number(voteValue) * 100), // Convert voteValue to weight (e.g., 100% = 10000)
        },
      ];

      const hiveClient = getHiveClient();
      await vote(privateKey, voteOperation, hiveClient);

      // Create a disabled button labeled "Voted!" with a valid custom_id
      const votedButton = new ButtonBuilder()
        .setCustomId('voted_button') // Set a valid custom_id
        .setLabel('Voted!')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(votedButton);

      await interaction.update({ components: [actionRow] }); // Update the message with the disabled button
    } catch (error) {
      console.error('Error processing vote button interaction:', error);
      await interaction.reply({ content: 'Failed to cast the vote. Please try again later.', flags: 64 });
    }
  }
});

discordClient.login(process.env.DISCORD_TOKEN);
