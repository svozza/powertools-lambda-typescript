import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { ApiGatewayV2Envelope } from '../../../src/envelopes/api-gatewayv2.js';
import { ParseError } from '../../../src/errors.js';
import { JSONStringified } from '../../../src/helpers/index.js';
import type { APIGatewayProxyEventV2 } from '../../../src/types/schema.js';
import { getTestEvent, omit } from '../helpers/utils.js';

describe('Envelope: API Gateway HTTP', () => {
  const schema = z
    .object({
      message: z.string(),
    })
    .strict();
  const baseEvent = getTestEvent<APIGatewayProxyEventV2>({
    eventsPath: 'apigw-http',
    filename: 'no-auth',
  });

  describe('Method: parse', () => {
    it('throws if the payload does not match the schema', () => {
      // Prepare
      const event = structuredClone(baseEvent);

      // Act & Assess
      expect(() => ApiGatewayV2Envelope.parse(event, schema)).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            'Failed to parse API Gateway HTTP body'
          ),
          cause: expect.objectContaining({
            issues: [
              {
                code: 'invalid_type',
                expected: 'object',
                received: 'undefined',
                path: ['body'],
                message: 'Required',
              },
            ],
          }),
        })
      );
    });

    it('parses an API Gateway HTTP event with plain text', () => {
      // Prepare
      const event = structuredClone(baseEvent);
      event.body = 'hello world';

      // Act
      const result = ApiGatewayV2Envelope.parse(event, z.string());

      // Assess
      expect(result).toEqual('hello world');
    });

    it('parses an API Gateway HTTP event with JSON-stringified body', () => {
      // Prepare
      const event = structuredClone(baseEvent);
      event.body = JSON.stringify({ message: 'hello world' });

      // Act
      const result = ApiGatewayV2Envelope.parse(event, JSONStringified(schema));

      // Assess
      expect(result).toStrictEqual({ message: 'hello world' });
    });

    it('parses an API Gateway HTTP event with binary body', () => {
      // Prepare
      const event = structuredClone(baseEvent);
      event.body = 'aGVsbG8gd29ybGQ='; // base64 encoded 'hello world'
      event.headers['content-type'] = 'application/octet-stream';
      event.isBase64Encoded = true;

      // Act
      const result = ApiGatewayV2Envelope.parse(event, z.string());

      // Assess
      expect(result).toEqual('aGVsbG8gd29ybGQ=');
    });
  });

  describe('Method: safeParse', () => {
    it('parses an API Gateway HTTP event', () => {
      // Prepare
      const event = structuredClone(baseEvent);
      event.body = JSON.stringify({ message: 'hello world' });

      // Act
      const result = ApiGatewayV2Envelope.safeParse(
        event,
        JSONStringified(schema)
      );

      // Assess
      expect(result).toEqual({
        success: true,
        data: { message: 'hello world' },
      });
    });

    it('returns an error if the event is not a valid API Gateway HTTP event', () => {
      // Prepare
      const event = omit(['rawPath'], structuredClone(baseEvent));

      // Act
      const result = ApiGatewayV2Envelope.safeParse(event, schema);

      // Assess
      expect(result).be.deep.equal({
        success: false,
        error: new ParseError('Failed to parse API Gateway HTTP body', {
          cause: new ZodError([
            {
              code: 'invalid_type',
              expected: 'string',
              received: 'undefined',
              path: ['rawPath'],
              message: 'Required',
            },
            {
              code: 'invalid_type',
              expected: 'object',
              received: 'undefined',
              path: ['body'],
              message: 'Required',
            },
          ]),
        }),
        originalEvent: event,
      });
    });
  });
});
