import { describe, expect, it } from 'vitest';

import {
  NO_SITE_STAMP,
  SIGNED_OUT,
  SITE_SHARE_USED,
  STAMP_NOT_USABLE,
  STAMP_RAN_OUT,
  stampRefusal,
  SUBSIDISED,
  uploadProblem,
} from '../../src/features/chat/stamp/stampProblems';
import { StampedUploadError } from '../../src/swarm/providers/bee-http/stampedSocUpload';
import { Weeb3PushError } from '../../src/swarm/providers/weeb-3/weeb3Push';

const refusal = (code: string, reason?: string) => Object.assign(new Error(code), { code, reason });

describe('why Swarm ID did not stamp a message', () => {
  it('fails the message at once for what a resend cannot mend', () => {
    expect(stampRefusal(refusal('not-authenticated'))).toEqual({ text: SIGNED_OUT, final: true });
    expect(stampRefusal(refusal('upload-unavailable', 'no-stamp'))).toEqual({ text: NO_SITE_STAMP, final: true });
    expect(stampRefusal(refusal('upload-unavailable', 'subsidised'))).toEqual({ text: SUBSIDISED, final: true });
    expect(stampRefusal(refusal('upload-unavailable', 'stamp-expired'))).toEqual({ text: STAMP_RAN_OUT, final: true });
    expect(stampRefusal(refusal('upload-unavailable', 'stamp-not-usable'))).toEqual({
      text: STAMP_NOT_USABLE,
      final: true,
    });
    for (const reason of ['app-stamp-count', 'app-bucket-share', 'app-slice-full']) {
      expect(stampRefusal(refusal('upload-unavailable', reason))).toEqual({ text: SITE_SHARE_USED, final: true });
    }
  });

  it('leaves the chat to resend what may pass a moment later', () => {
    for (const error of [
      refusal('upload-unavailable', 'app-stamp-rate'),
      refusal('upload-unavailable', 'session-unconfirmed'),
      refusal('timeout'),
      refusal('lease-lost'),
      new Error('anything else'),
    ]) {
      expect(stampRefusal(error).final).toBe(false);
    }
  });
});

describe("why the viewer's Bee node did not take a message", () => {
  it('resends after no answer, a rate limit or a server error, and fails at once on a refusal', () => {
    expect(uploadProblem(new StampedUploadError(null, null, true))).toEqual({
      text: 'Your Bee node did not answer in time.',
      final: false,
    });
    expect(uploadProblem(new StampedUploadError(429, null, false)).final).toBe(false);
    expect(uploadProblem(new StampedUploadError(402, 'payment required', false))).toEqual({
      text: 'Your Bee node refused it (HTTP 402: payment required).',
      final: true,
    });
  });
});

describe('why the node in this browser did not push a message', () => {
  it('fails at once when it gave no answer by the deadline, since a stamp it will not take never answers', () => {
    expect(uploadProblem(new Weeb3PushError('deadline', null))).toEqual({
      text: 'Weeb3 did not confirm it within a minute. It gives no answer for a stamp it will not take, so it is not sent again by itself.',
      final: true,
    });
  });

  it('fails at once on a refusal it named, saying what it said', () => {
    expect(uploadProblem(new Weeb3PushError('refused', 'Upload result: invalid stamp'))).toEqual({
      text: 'Weeb3 refused it (Upload result: invalid stamp).',
      final: true,
    });
  });

  it('leaves the chat to resend while the node is not running, which the next push starts again', () => {
    expect(uploadProblem(new Weeb3PushError('node', null))).toEqual({
      text: 'The Swarm node in this browser is not running.',
      final: false,
    });
  });

  it('fails at once on a stamp of the wrong size, which a resend would hand over again', () => {
    expect(uploadProblem(new Weeb3PushError('stamp-size', null))).toEqual({
      text: 'Swarm ID gave a stamp of the wrong size.',
      final: true,
    });
  });
});
