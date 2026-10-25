import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const body = Buffer.from(JSON.stringify({
  full_name: 'repo/cassette',
  owner: {login: 'repo', avatar_url: 'https://example.invalid/benign.png'},
  description: 'percent-token-mime-marker',
  stargazers_count: 0,
}));
const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'repo-cassette-percent-token-mime-probe',
};

const results = [];
for (const [index, mimeType] of [
  '%85application/json',
  '%C2%85application/json',
  'application/json%85',
].entries()) {
  const name = `repo-cassette-percent-token-${index}-${process.env.GITHUB_RUN_ID}`;
  try {
    const made = await client.CreateArtifact({
      ...backend,
      name,
      version: 7,
      mimeType: StringValue.create({value: mimeType}),
    });
    if (!made.ok) throw new Error('create-not-ok');
    await new BlobClient(made.signedUploadUrl).getBlockBlobClient().uploadData(body, {
      blobHTTPHeaders: {blobContentType: mimeType},
    });
    const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
    if (!done.ok) throw new Error('finalize-not-ok');
    const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
    const first = await fetch(url, {headers, redirect: 'manual'});
    const location = first.headers.get('location');
    const signed = location ? new URL(location) : null;
    const final = location ? await fetch(location) : first;
    const bytes = Buffer.from(await final.arrayBuffer());
    const finalType = final.headers.get('content-type') || '';
    results.push({
      mimeType,
      artifactId: String(done.artifactId),
      firstStatus: first.status,
      finalStatus: final.status,
      signedRsct: signed ? signed.searchParams.get('rsct') : null,
      finalType,
      finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
      bodyMatches: bytes.equals(body),
      size: bytes.length,
    });
  } catch (error) {
    results.push({mimeType, error: String(error?.message || error).slice(0, 180)});
  }
}
console.log('PERCENT_TOKEN_MIME_RESULT', JSON.stringify(results));
