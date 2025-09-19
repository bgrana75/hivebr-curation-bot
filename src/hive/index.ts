import { Client, CommentOperation, CommentOptionsOperation, Operation, PrivateKey, VoteOperation } from '@hiveio/dhive';

const HIVE_NODES = [
    'https://api.hive.blog',
    'https://api.openhive.network',
    'https://api.deathwing.me',
    'https://hive-api.arcange.eu',
    'https://anyx.io',
    'https://techcoderx.com'
];

let currentNodeIndex = 0;
let currentNode: Client;

export const getNextHiveClient = () => {
  currentNodeIndex = (currentNodeIndex + 1) % HIVE_NODES.length;
  console.log(`Switching to Hive node: ${HIVE_NODES[currentNodeIndex]}`);
  currentNode = new Client(HIVE_NODES[currentNodeIndex]);
  return currentNode;
};

export const getHiveClient = () => {
  if (!currentNode) {
    return getNextHiveClient();
  }
  return currentNode;
};

export async function vote(
  privateKey: string,
  voter: string,
  author: string,
  permlink: string,
  voteValue: string,
): Promise<void> {
  try {
    const client = getHiveClient();
    const voteOperation: VoteOperation = [
        'vote',
        {
          voter,
          author,
          permlink,
          weight: Math.round(Number(voteValue) * 100), // Convert voteValue to weight (e.g., 100% = 10000)
        },
      ];
    await client.broadcast.sendOperations([voteOperation], PrivateKey.fromString(privateKey));
    console.log("Vote operation successfully broadcasted");
  } catch (error) {
    console.error("Error broadcasting vote operation:", error);
    throw error;
  }
}

export async function comment(
    privateKey: string,
    author: string,
    permlink: string,
    parent_author: string,
    parent_permlink: string,
    title: string,
    body: string,
  ) {
    const client = getHiveClient();
    const commentOptions: CommentOptionsOperation = [
        "comment_options",
        {
            author: String(author),
            permlink: String(permlink),
            max_accepted_payout: "10000.000 HBD",
            percent_hbd: 10000,
            allow_votes: true,
            allow_curation_rewards: true,
            extensions: [
                [
                    0,
                    {
                        beneficiaries: [
                            {
                               account: "hive-br", //alterado shiftrox 18/09/2025
                               weight: 10000,
                           },
                        ],
                    },
                ],
            ],
        },
    ];
    const commentOperation: CommentOperation = [
        "comment",
        {
            parent_author: String(parent_author),
            parent_permlink: String(parent_permlink),
            author: String(author),
            permlink: String(permlink),
            title: String(title),
            body: String(body),
            json_metadata: JSON.stringify({
                // tags: ["tag"],
                // app: "appname",
                // image: "/image.svg",
            }),
        },
    ];
    //console.log('commentOperation:', commentOperation);
    //console.log('commentOptions:', commentOptions);
    
    const ops: Operation[] = [
        commentOperation,
        commentOptions
    ];
    try {
        await client.broadcast.sendOperations(ops, PrivateKey.fromString(privateKey));
        console.log("Comment operation successfully broadcasted");
    } catch (error) {
        console.error("Error broadcasting vote operation:", error);
        throw error;
    }
  }