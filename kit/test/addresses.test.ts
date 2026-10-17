import { describe, expect, it } from 'vitest';

import {
  addressesFor,
  Addressing,
  isLocalDevHost,
  isLocalRequest,
  knownOutsideRequest,
  nonLocalAddresses,
} from '../src/addresses.ts';

describe('isLocalDevHost', () => {
  it('takes the loopback names and every name under localhost', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', 'id.localhost', 'a.b.localhost', 'LOCALHOST']) {
      expect(isLocalDevHost(host), host).toBe(true);
    }
  });

  it('refuses every other host, a look-alike included', () => {
    for (const host of ['example.com', 'localhost.example.com', 'mylocalhost', '127.0.0.2', '192.0.2.1', 'queen', '']) {
      expect(isLocalDevHost(host), host).toBe(false);
    }
  });
});

describe('nonLocalAddresses', () => {
  it('names each address that is not on a local development host, and an address that is not a URL', () => {
    expect(
      nonLocalAddresses({
        viewer: 'http://127.0.0.1:4173',
        swarmId: 'http://id.localhost:5500',
        leak: 'https://gateway.example.com',
        broken: 'not a url',
      }),
    ).toEqual(['leak: https://gateway.example.com', 'broken: not a url']);
  });
});

describe('addressesFor', () => {
  it('puts every part on a local development host in both schemes', () => {
    for (const mode of Object.values(Addressing)) {
      const addresses = addressesFor(mode);
      expect(nonLocalAddresses(addresses.all()), mode).toEqual([]);
    }
  });

  it('serves the viewer and Swarm ID on names of their own under localhost, or on two loopback literals', () => {
    expect(addressesFor(Addressing.NAMES)).toMatchObject({
      viewer: 'http://viewer.localhost:4180',
      swarmId: 'http://id.localhost:5500',
    });
    expect(addressesFor(Addressing.LOOPBACK)).toMatchObject({
      viewer: 'http://127.0.0.1:4180',
      swarmId: 'http://localhost:5500',
    });
  });

  it('serves the hostile site on a third loopback site, apart from the viewer and from Swarm ID', () => {
    for (const mode of Object.values(Addressing)) {
      const addresses = addressesFor(mode);
      const site = (url: string) => new URL(url).hostname.replace(/^\[|\]$/g, '');
      expect(site(addresses.evil), mode).not.toBe(site(addresses.viewer));
      expect(site(addresses.evil), mode).not.toBe(site(addresses.swarmId));
    }
    expect(new URL(addressesFor(Addressing.LOOPBACK).evil).hostname).toBe('[::1]');
  });

  it('serves a strict Swarm ID build, a different origin from the one the viewer uses', () => {
    for (const mode of Object.values(Addressing)) {
      const addresses = addressesFor(mode);
      expect(addresses.swarmIdStrict, mode).not.toBe(addresses.swarmId);
    }
  });

  it('keeps the viewer off 4173, where the e2e suite serves its preview', () => {
    for (const mode of Object.values(Addressing)) expect(new URL(addressesFor(mode).viewer).port).not.toBe('4173');
  });
});

describe('isLocalRequest', () => {
  it('lets a request to a local development host through, and one to anywhere else not', () => {
    expect(isLocalRequest('http://127.0.0.1:4180/config.json')).toBe(true);
    expect(isLocalRequest('ws://localhost:5520/bus')).toBe(true);
    expect(isLocalRequest('https://fonts.example.com/a.woff2')).toBe(false);
    expect(isLocalRequest('https://localhost.example.com/')).toBe(false);
  });

  it('lets through what never leaves the browser', () => {
    expect(isLocalRequest('data:text/plain,x')).toBe(true);
    expect(isLocalRequest('blob:http://127.0.0.1:4180/7c1e')).toBe(true);
    expect(isLocalRequest('about:blank')).toBe(true);
  });
});

describe('knownOutsideRequest', () => {
  it('names the outside requests the release is known to make, and nothing else', () => {
    expect(knownOutsideRequest('GET https://rsms.me/inter/font-files/InterVariable.woff2')).toMatch(/font/);
    expect(knownOutsideRequest('POST https://cloudflare-eth.com/')).toMatch(/endpoint/);
    expect(knownOutsideRequest('GET https://example.org/x')).toBeNull();
  });
});
