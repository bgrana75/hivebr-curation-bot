import { Client, CommentOperation, CommentOptionsOperation, Operation, PrivateKey, VoteOperation } from '@hiveio/dhive';
import { get } from 'http';

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
    //console.log("Broadcasting vote operation:", vote);
    // await client.broadcast.sendOperations([
    //     ['vote', {
    //       voter: 'skatedev',
    //       author: 'richardoswal',
    //       permlink: 'cartas-rebelion-blackmoor-tricksterrebellion-cards-blackmoor-trickster',
    //       weight: 3000
    //     }]
    //   ], PrivateKey.fromString(privateKey));
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
            permlink: permlink,
            max_accepted_payout: "10000.000 HBD",
            percent_hbd: 10000,
            allow_votes: true,
            allow_curation_rewards: true,
            extensions: [
                [
                    0,
                    {
                        beneficiaries: [
                            // {
                            //     account: "hiveusername",
                            //     weight: 1000,
                            // },
                        ],
                    },
                ],
            ],
        },
    ];
    const commentOperation: CommentOperation = [
        "comment",
        {
            parent_author: parent_author,
            parent_permlink: parent_permlink,
            author: String(author),
            permlink: permlink,
            title: title,
            body: body,
            json_metadata: JSON.stringify({
                // tags: ["tag"],
                // app: "appname",
                // image: "/image.svg",
            }),
        },
    ];

    const ops: Operation[] = [
        ['comment', commentOperation],
        ['comment_options', commentOptions]
    ];
    try {
        await client.broadcast.sendOperations(ops, PrivateKey.fromString(privateKey));
        console.log("Vote operation successfully broadcasted");
    } catch (error) {
        console.error("Error broadcasting vote operation:", error);
        throw error;
    }
  }