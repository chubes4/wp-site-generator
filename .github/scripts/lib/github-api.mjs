export function githubToken(env = process.env, names = ['GH_TOKEN', 'GITHUB_TOKEN']) {
	for (const name of names) {
		if (env[name]) {
			return env[name];
		}
	}
	return '';
}

export async function githubApi({ repo, endpoint, token = githubToken(), init = {}, failMessage } = {}) {
	if (!repo) {
		throw new Error('GitHub repository is required.');
	}
	if (!endpoint) {
		throw new Error('GitHub API endpoint is required.');
	}
	if (!token) {
		throw new Error('GH_TOKEN or GITHUB_TOKEN is required.');
	}

	const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.headers || {}),
		},
	});
	if (!response.ok) {
		const detail = `GitHub API ${endpoint} failed: ${response.status} ${await response.text()}`;
		throw new Error(failMessage ? failMessage(detail) : detail);
	}
	return response;
}

export async function githubJson(options) {
	const response = await githubApi(options);
	return response.json();
}
