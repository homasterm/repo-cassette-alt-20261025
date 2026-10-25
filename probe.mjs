import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `omitted-mime-${process.env.GITHUB_RUN_ID}.json`;
const result = {name};
try {
  const made = await client.CreateArtifact({...backend, name, version: 7});
  if (!made.ok) throw new Error('create-not-ok');
  result.created = true;
  const placeholder = Buffer.from('{}');
  const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
  await block.uploadData(placeholder, {
    blobHTTPHeaders: {blobContentType: 'application/octet-stream'},
  });
  const done = await client.FinalizeArtifact({...backend, name, size: String(placeholder.length)});
  if (!done.ok) throw new Error('finalize-not-ok');
  result.artifactId = String(done.artifactId);
  const repository = `${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`;
  const finalBody = Buffer.from(JSON.stringify({
    full_name: repository,
    owner: {login: 'control', avatar_url: 'https://example.invalid/benign.png'},
    description: 'omitted-mime-json-name-marker',
    stargazers_count: 0,
  }));
  await block.uploadData(finalBody, {
    blobHTTPHeaders: {blobContentType: '\u0085application/json'},
  });
  result.overwrite = true;
  const first = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'repo-cassette-omitted-mime-json-name-probe',
      },
      redirect: 'manual',
    },
  );
  const location = first.headers.get('location');
  const final = location ? await fetch(location) : first;
  const bytes = Buffer.from(await final.arrayBuffer());
  result.firstStatus = first.status;
  result.finalStatus = final.status;
  result.finalType = final.headers.get('content-type') || '';
  result.finalTypeCodePoints = Array.from(result.finalType, c => c.codePointAt(0));
  result.bodyMatches = bytes.equals(finalBody);
  result.size = bytes.length;
} catch (error) {
  result.error = String(error?.message || error).slice(0, 180);
}
console.log('OMITTED_MIME_JSON_NAME_RESULT', JSON.stringify(result));
