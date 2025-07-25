import { unmarshallDynamoDB } from '@aws-lambda-powertools/commons/utils/unmarshallDynamoDB';
import { z } from 'zod';
import type { KinesisEnvelope } from '../envelopes/kinesis.js';
import type { DynamoDBMarshalled } from '../helpers/dynamodb.js';
import type { DynamoDBStreamEvent } from '../types/schema.js';

const DynamoDBStreamChangeRecordBase = z.object({
  ApproximateCreationDateTime: z.number().optional(),
  Keys: z.record(z.string(), z.record(z.string(), z.any())),
  NewImage: z.record(z.string(), z.any()).optional(),
  OldImage: z.record(z.string(), z.any()).optional(),
  SequenceNumber: z.string(),
  SizeBytes: z.number(),
  StreamViewType: z.enum([
    'NEW_IMAGE',
    'OLD_IMAGE',
    'NEW_AND_OLD_IMAGES',
    'KEYS_ONLY',
  ]),
});

const DynamoDBStreamToKinesisChangeRecord = DynamoDBStreamChangeRecordBase.omit(
  {
    SequenceNumber: true,
    StreamViewType: true,
  }
);

const unmarshallDynamoDBTransform = (
  object:
    | z.infer<typeof DynamoDBStreamChangeRecordBase>
    | z.infer<typeof DynamoDBStreamToKinesisChangeRecord>,
  ctx: z.RefinementCtx
) => {
  const result = { ...object };

  const unmarshallAttributeValue = (
    imageName: 'NewImage' | 'OldImage' | 'Keys',
    image: Record<string, unknown>
  ) => {
    try {
      // @ts-expect-error
      return unmarshallDynamoDB(image) as Record<string, unknown>;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `Could not unmarshall ${imageName} in DynamoDB stream record`,
        fatal: true,
        path: [imageName],
      });
      return z.NEVER;
    }
  };

  const unmarshalledKeys = unmarshallAttributeValue('Keys', object.Keys);
  if (unmarshalledKeys === z.NEVER) return z.NEVER;
  // @ts-expect-error - We are intentionally mutating the object
  result.Keys = unmarshalledKeys;

  if (object.NewImage) {
    const unmarshalled = unmarshallAttributeValue('NewImage', object.NewImage);
    if (unmarshalled === z.NEVER) return z.NEVER;
    result.NewImage = unmarshalled;
  }

  if (object.OldImage) {
    const unmarshalled = unmarshallAttributeValue('OldImage', object.OldImage);
    if (unmarshalled === z.NEVER) return z.NEVER;
    result.OldImage = unmarshalled;
  }

  return result;
};

const DynamoDBStreamChangeRecord = DynamoDBStreamChangeRecordBase.transform(
  unmarshallDynamoDBTransform
);

const UserIdentity = z.object({
  type: z.enum(['Service']),
  principalId: z.literal('dynamodb.amazonaws.com'),
});

const DynamoDBStreamRecord = z.object({
  eventID: z.string(),
  eventName: z.enum(['INSERT', 'MODIFY', 'REMOVE']),
  eventVersion: z.string(),
  eventSource: z.literal('aws:dynamodb'),
  awsRegion: z.string(),
  eventSourceARN: z.string(),
  dynamodb: DynamoDBStreamChangeRecord,
  userIdentity: UserIdentity.optional(),
});

/**
 * Zod schema for Amazon DynamoDB Stream event sent to an Amazon Kinesis Stream.
 *
 * This schema is best used in conjunction with the {@link KinesisEnvelope | `KinesisEnvelope`} when
 * you want to work with the DynamoDB stream event coming from an Amazon Kinesis Stream.
 *
 * By default, we unmarshall the `dynamodb.Keys`, `dynamodb.NewImage`, and `dynamodb.OldImage` fields
 * for you.
 *
 * If you want to extend the schema and provide your own Zod schema for any of these fields,
 * you can use the {@link DynamoDBMarshalled | `DynamoDBMarshalled`} helper. In that case, we won't unmarshall the other fields.
 *
 * To extend the schema, you can use the {@link DynamoDBStreamToKinesisRecord | `DynamoDBStreamToKinesisRecord`} child schema and the {@link DynamoDBMarshalled | `DynamoDBMarshalled`}
 * helper together.
 *
 * @example
 * ```ts
 * import {
 *   DynamoDBStreamToKinesisRecord,
 *   DynamoDBStreamToKinesisChangeRecord,
 * } from '@aws-lambda-powertools/parser/schemas/dynamodb';
 * import { KinesisEnvelope } from '@aws-lambda-powertools/parser/envelopes/dynamodb';
 * import { DynamoDBMarshalled } from '@aws-lambda-powertools/parser/helpers/dynamodb';
 *
 * const CustomSchema = DynamoDBStreamToKinesisRecord.extend({
 *   dynamodb: DynamoDBStreamToKinesisChangeRecord.extend({
 *    NewImage: DynamoDBMarshalled(
 *      z.object({
 *        id: z.string(),
 *        attribute: z.number(),
 *        stuff: z.array(z.string()),
 *      })
 *    ),
 *    // Add the lines below only if you want these keys to be unmarshalled
 *    Keys: DynamoDBMarshalled(z.unknown()),
 *    OldImage: DynamoDBMarshalled(z.unknown()),
 *  }),
 * });
 *
 * type CustomEvent = z.infer<typeof CustomSchema>;
 * ```
 */
const DynamoDBStreamToKinesisRecord = DynamoDBStreamRecord.extend({
  recordFormat: z.literal('application/json'),
  tableName: z.string(),
  userIdentity: UserIdentity.nullish(),
  dynamodb: DynamoDBStreamToKinesisChangeRecord.transform(
    unmarshallDynamoDBTransform
  ),
}).omit({
  eventVersion: true,
  eventSourceARN: true,
});

/**
 * Zod schema for Amazon DynamoDB Stream event.
 *
 * @example
 * ```json
 * {
 *   "Records":[{
 *     "eventID":"1",
 *     "eventName":"INSERT",
 *     "eventVersion":"1.0",
 *     "eventSource":"aws:dynamodb",
 *     "awsRegion":"us-east-1",
 *     "dynamodb":{
 *       "Keys":{
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "NewImage":{
 *         "Message":{
 *           "S":"New item!"
 *         },
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "SequenceNumber":"111",
 *       "SizeBytes":26,
 *       "StreamViewType":"NEW_AND_OLD_IMAGES"
 *     },
 *     "eventSourceARN":"stream-ARN"
 *   },
 *   {
 *     "eventID":"2",
 *     "eventName":"MODIFY",
 *     "eventVersion":"1.0",
 *     "eventSource":"aws:dynamodb",
 *     "awsRegion":"us-east-1",
 *     "dynamodb":{
 *       "Keys":{
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "NewImage":{
 *         "Message":{
 *           "S":"This item has changed"
 *         },
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "OldImage":{
 *         "Message":{
 *           "S":"New item!"
 *         },
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "SequenceNumber":"222",
 *       "SizeBytes":59,
 *       "StreamViewType":"NEW_AND_OLD_IMAGES"
 *     },
 *     "eventSourceARN":"stream-ARN"
 *   },
 *   {
 *     "eventID":"3",
 *     "eventName":"REMOVE",
 *     "eventVersion":"1.0",
 *     "eventSource":"aws:dynamodb",
 *     "awsRegion":"us-east-1",
 *     "dynamodb":{
 *       "Keys":{
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "OldImage":{
 *         "Message":{
 *           "S":"This item has changed"
 *         },
 *         "Id":{
 *           "N":"101"
 *         }
 *       },
 *       "SequenceNumber":"333",
 *       "SizeBytes":38,
 *       "StreamViewType":"NEW_AND_OLD_IMAGES"
 *     },
 *     "eventSourceARN":"stream-ARN"
 *   }],
 *   "window": {
 *     "start": "2020-07-30T17:00:00Z",
 *     "end": "2020-07-30T17:05:00Z"
 *   },
 *   "state": {
 *     "1": "state1"
 *   },
 *   "shardId": "shard123456789",
 *   "eventSourceARN": "stream-ARN",
 *   "isFinalInvokeForWindow": false,
 *   "isWindowTerminatedEarly": false
 * }
 * ```
 *
 * @see {@link DynamoDBStreamEvent | DynamoDBStreamEvent}
 * @see {@link https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html}
 */
const DynamoDBStreamSchema = z.object({
  Records: z.array(DynamoDBStreamRecord).nonempty(),
  window: z
    .object({
      start: z.iso.datetime(),
      end: z.iso.datetime(),
    })
    .optional(),
  state: z.record(z.string(), z.string()).optional(),
  shardId: z.string().optional(),
  eventSourceARN: z.string().optional(),
  isFinalInvokeForWindow: z.boolean().optional(),
  isWindowTerminatedEarly: z.boolean().optional(),
});

export {
  DynamoDBStreamToKinesisRecord,
  DynamoDBStreamToKinesisChangeRecord,
  DynamoDBStreamSchema,
  DynamoDBStreamRecord,
  DynamoDBStreamChangeRecord,
  DynamoDBStreamChangeRecordBase,
  UserIdentity,
};
