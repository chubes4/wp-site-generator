export function normalizeVisualRegions(value, options = {}) {
	const maxRegions = options.maxRegions ?? 8;
	return asArray(value)
		.filter((region) => region && typeof region === 'object')
		.slice(0, maxRegions)
		.map((region) => ({
			rank: normalizeNumber(region.rank, options),
			x: normalizeNumber(region.x, options),
			y: normalizeNumber(region.y, options),
			width: normalizeNumber(region.width, options),
			height: normalizeNumber(region.height, options),
			mismatchPixels: normalizeNumber(region.mismatchPixels, options),
			totalPixels: normalizeNumber(region.totalPixels, options),
			mismatchRatio: normalizeNumber(region.mismatchRatio, options),
			source_matches: normalizeVisualProbes(region.source_matches, options),
			imported_matches: normalizeVisualProbes(region.imported_matches, options),
			layout_deltas: normalizeVisualLayoutDeltas(region.layout_deltas, options),
		}));
}

export function normalizeVisualProbes(value, options = {}) {
	const maxProbes = options.maxProbes ?? 5;
	return asArray(value)
		.filter((probe) => probe && typeof probe === 'object')
		.slice(0, maxProbes)
		.map((probe) => ({
			selector: normalizeText(probe.selector, options),
			path: normalizeText(probe.path, options),
			text: normalizeText(probe.text, { ...options, maxLength: options.textLimit }),
			html: normalizeText(probe.html, { ...options, maxLength: options.htmlLimit }),
			child_summary: normalizeText(probe.child_summary, { ...options, maxLength: options.childSummaryLimit }),
			computed_style: normalizeStyle(probe.computed_style, options),
			matched_css_rules: normalizeCssRules(probe.matched_css_rules, options),
			rect: probe.rect && typeof probe.rect === 'object' ? {
				x: normalizeNumber(probe.rect.x, options),
				y: normalizeNumber(probe.rect.y, options),
				width: normalizeNumber(probe.rect.width, options),
				height: normalizeNumber(probe.rect.height, options),
			} : {},
		}));
}

export function visualCodeEvidenceFromRegion(region, options = {}) {
	return {
		source: asArray(region?.source_matches).slice(0, 3).map((probe) => probeCodeEvidence(probe, options)),
		imported: asArray(region?.imported_matches).slice(0, 3).map((probe) => probeCodeEvidence(probe, options)),
	};
}

export function visualCodeEvidenceFromPacket(packet, options = {}) {
	const configured = packet?.visual_code_evidence;
	if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
		return {
			source: normalizeVisualProbes(configured.source, options),
			imported: normalizeVisualProbes(configured.imported, options),
		};
	}
	const region = normalizeVisualRegions(packet?.visual_regions, options)[0];
	return region ? {
		source: region.source_matches,
		imported: region.imported_matches,
	} : {};
}

export function summarizeVisualDiff(diff, options = {}) {
	if (!diff || typeof diff !== 'object') {
		return null;
	}

	return {
		pass: Boolean(diff.pass),
		threshold: numberOrNull(diff.threshold),
		mismatch_pixels: numberOrNull(diff.mismatchPixels),
		total_pixels: numberOrNull(diff.totalPixels),
		mismatch_ratio: numberOrNull(diff.mismatchRatio),
		dimension_mismatch: Boolean(diff.dimensionMismatch),
		source: imageSummary(diff.source),
		imported: imageSummary(diff.imported),
		diff: imageSummary(diff.diff),
		regions: asArray(diff.regions).slice(0, options.maxSummaryRegions ?? 3).map((region) => summarizeRegion(region, options)),
	};
}

export function visualRegionSummary(region, options = {}) {
	return [
		`region ${region.x},${region.y} ${region.width}x${region.height}`,
		`source: ${probeSummary(region.source_matches, options)}`,
		`imported: ${probeSummary(region.imported_matches, options)}`,
	].join('; ');
}

export function probeSummary(probes, options = {}) {
	const probe = asArray(probes)[0];
	if (!probe) {
		return 'none';
	}
	if (options.includeStyleLabels) {
		return truncate([probe.selector, probe.text, styleSummary(probe.computed_style)].filter(Boolean).join(' '), options.maxSummaryLength ?? 160);
	}
	const style = probe.computed_style && typeof probe.computed_style === 'object' ? probe.computed_style : {};
	return [probe.selector, probe.text, style.display, style['font-size'], style['background-color']]
		.filter((value) => normalizeText(value) !== '')
		.join(' ');
}

export function formatRatio(value) {
	const number = Number(value);
	return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : 'unknown';
}

function summarizeRegion(region, options) {
	return {
		rank: numberOrNull(region.rank),
		x: numberOrNull(region.x),
		y: numberOrNull(region.y),
		width: numberOrNull(region.width),
		height: numberOrNull(region.height),
		mismatch_pixels: numberOrNull(region.mismatchPixels),
		total_pixels: numberOrNull(region.totalPixels),
		mismatch_ratio: numberOrNull(region.mismatchRatio),
		source_matches: summarizeMatches(region.source_matches, options),
		imported_matches: summarizeMatches(region.imported_matches, options),
		layout_deltas: summarizeLayoutDeltas(region.layout_deltas, options),
	};
}

function summarizeMatches(matches, options) {
	return asArray(matches).slice(0, 1).map((match) => ({
		selector: normalizeText(match.selector),
		path: normalizeText(match.path),
		text: compactText(match.text, options.matchTextLength ?? 120),
		child_summary: compactText(match.child_summary, options.matchChildSummaryLength ?? 160),
		rect: match.rect && typeof match.rect === 'object'
			? {
				x: numberOrNull(match.rect.x),
				y: numberOrNull(match.rect.y),
				width: numberOrNull(match.rect.width),
				height: numberOrNull(match.rect.height),
			}
			: null,
	}));
}

function summarizeLayoutDeltas(deltas, options) {
	return asArray(deltas).slice(0, 1).map((delta) => ({
		pair: numberOrNull(delta.pair),
		source_selector: normalizeText(delta.source_selector),
		imported_selector: normalizeText(delta.imported_selector),
		source_path: normalizeText(delta.source_path),
		imported_path: normalizeText(delta.imported_path),
		source_child_summary: compactText(delta.source_child_summary, options.deltaChildSummaryLength ?? 160),
		imported_child_summary: compactText(delta.imported_child_summary, options.deltaChildSummaryLength ?? 160),
		rect_delta: delta.rect_delta && typeof delta.rect_delta === 'object'
			? {
				x: numberOrNull(delta.rect_delta.x),
				y: numberOrNull(delta.rect_delta.y),
				width: numberOrNull(delta.rect_delta.width),
				height: numberOrNull(delta.rect_delta.height),
			}
			: null,
		style_diffs: asArray(delta.style_diffs).slice(0, 3).map((diff) => ({
			property: normalizeText(diff.property),
			source: compactText(diff.source, options.styleDiffLength ?? 80),
			imported: compactText(diff.imported, options.styleDiffLength ?? 80),
		})),
	}));
}

function probeCodeEvidence(probe, options) {
	return {
		selector: normalizeText(probe.selector),
		path: normalizeText(probe.path),
		text: normalizeText(probe.text, { ...options, maxLength: options.textLimit ?? 180 }),
		html: normalizeText(probe.html, { ...options, maxLength: options.htmlLimit ?? 1000 }),
		child_summary: normalizeText(probe.child_summary, { ...options, maxLength: options.childSummaryLimit ?? 500 }),
		computed_style: normalizeStyle(probe.computed_style, options),
		matched_css_rules: normalizeCssRules(probe.matched_css_rules, options),
	};
}

function normalizeVisualLayoutDeltas(value, options) {
	return asArray(value)
		.filter((delta) => delta && typeof delta === 'object')
		.slice(0, options.maxLayoutDeltas ?? 3)
		.map((delta) => ({
			pair: normalizeNumber(delta.pair, options),
			source_selector: normalizeText(delta.source_selector, options),
			imported_selector: normalizeText(delta.imported_selector, options),
			source_path: normalizeText(delta.source_path, options),
			imported_path: normalizeText(delta.imported_path, options),
			source_child_summary: normalizeText(delta.source_child_summary, { ...options, maxLength: options.childSummaryLimit }),
			imported_child_summary: normalizeText(delta.imported_child_summary, { ...options, maxLength: options.childSummaryLimit }),
			rect_delta: delta.rect_delta && typeof delta.rect_delta === 'object' ? {
				x: normalizeNumber(delta.rect_delta.x, options),
				y: normalizeNumber(delta.rect_delta.y, options),
				width: normalizeNumber(delta.rect_delta.width, options),
				height: normalizeNumber(delta.rect_delta.height, options),
			} : {},
			style_diffs: asArray(delta.style_diffs)
				.filter((diff) => diff && typeof diff === 'object')
				.slice(0, options.maxStyleDiffs ?? 16)
				.map((diff) => ({
					property: normalizeText(diff.property, options),
					source: normalizeText(diff.source, { ...options, maxLength: options.styleDiffLimit }),
					imported: normalizeText(diff.imported, { ...options, maxLength: options.styleDiffLimit }),
				})),
		}));
}

function normalizeStyle(value, options = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const entries = Object.entries(value).map(([key, raw]) => [key, normalizeText(raw, { ...options, maxLength: options.styleLimit })]);
	return Object.fromEntries(options.dropEmptyStyleValues ? entries.filter(([, raw]) => raw !== '') : entries);
}

function normalizeCssRules(value, options = {}) {
	return asArray(value)
		.filter((rule) => rule && typeof rule === 'object')
		.slice(0, options.maxCssRules ?? 8)
		.map((rule) => ({
			selector: normalizeText(rule.selector, options),
			media: normalizeText(rule.media, options),
			css: normalizeText(rule.css, { ...options, maxLength: options.cssLimit }),
		}));
}

function imageSummary(value) {
	return value && typeof value === 'object'
		? {
			path: normalizeText(value.path),
			width: numberOrNull(value.width),
			height: numberOrNull(value.height),
		}
		: null;
}

function styleSummary(style) {
	if (!style || typeof style !== 'object') {
		return '';
	}
	return [
		['display', style.display],
		['font', style['font-family']],
		['size', style['font-size']],
		['bg', style['background-color']],
	]
		.filter(([, value]) => normalizeText(value) !== '')
		.map(([key, value]) => `${key}=${normalizeText(value)}`)
		.join(' ');
}

function normalizeNumber(value, options) {
	if (options.numberMode === 'numberOrString') {
		return numberOrString(value);
	}
	return Number(value || 0);
}

function normalizeText(value, options = {}) {
	const stringValue = text(value);
	return options.maxLength ? truncate(stringValue, options.maxLength) : stringValue;
}

function compactText(value, maxLength) {
	const compacted = text(value).replace(/\s+/g, ' ').trim();
	return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function truncate(value, length) {
	const stringValue = text(value);
	return stringValue.length <= length ? stringValue : stringValue.slice(0, length);
}

function numberOrString(value) {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : text(value);
}

function numberOrNull(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function text(value) {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return JSON.stringify(value);
}
