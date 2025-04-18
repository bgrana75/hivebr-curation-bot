import { Client, CommentOperation, CommentOptionsOperation, Operation, PrivateKey, VoteOperation } from '@hiveio/dhive';
import { title } from 'process';

export async function vote(
  privateKey: string,
  vote: VoteOperation,
  client: Client
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
    await client.broadcast.sendOperations([vote], PrivateKey.fromString(privateKey));
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
    client: Client
  ) {
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
                            //     account: "skatehacker",
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
                // tags: ["skateboard"],
                // app: "Skatehive App",
                // image: "/SKATE_HIVE_VECTOR_FIN.svg",
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