/*
 * marks.js - Simple, fast & extensible markup parsing, traversing & rendering.
 *
 * Copyright (c) 2008 - 2016, Juerg Lehni
 * http://scratchdisk.com/
 *
 * Distributed under the MIT license. See LICENSE file for details.
 *
 * All rights reserved.
 */

(function(exports) {
'use strict';
exports.version = '1.1.1';

var contexts = {};

exports.register = function(tags, description) {
	if (typeof tags === 'object') {
		for (var key in tags)
			this.register(key, tags[key]);
	} else {
		// Allow simple form of only defining a render function
		if (typeof description === 'function')
			description = { render: description };
		// Parse attributes definition through the same tag parsing
		// mechanism that Node is using. Node.parse contains
		// special logic to produce an info object for attribute / argument
		// parsing further down in Node.create().
		var attributes = description.attributes = description.attributes
					? Node.parse(description.attributes, null, true)
					: null;
		// Create lookup per tag name for description to be used.
		var context = description.context || 'default';
		context = contexts[context] = contexts[context] || {};
		tags = tags.split(',');
		// Create and register a new sub-class of Node, and copy over all fields
		// from description to its prototype.
		var proto = new Node();
		for (var i in description)
			if (description.hasOwnProperty(i))
				proto[i] = description[i];
		var ctor = function() {};
		ctor.prototype = proto;
		for (var i = 0; i < tags.length; i++)
			context[tags[i]] = ctor;
	}
};

// Parses the passed markup text to a DOM tree contained in a Node with
// name 'root', which can be rendered through its render function. This
// object can be used for caching. But that is not a necessity since parsing
// is very fast.
exports.parse = function(text, options) {
	if (!text)
		return null;
	// Create the root tag as a container for all the other bits
	var rootTag = Node.create('root');
	var start = 0, end = 0;
	// Current tag:
	var tag = rootTag;
	function addString(str) {
		// 'Unescape' escape characters, such as '\<', '\>'
		tag.nodes.push(str.replace(/\\(.)/g, function(all, chr) {
			return chr;
		}));
	}
	while (start !== -1) { 
		start = text.indexOf('<', end);
		// Filter out escaped '\<'
		while (start > 0 && text.charAt(start - 1) === '\\')
			start = text.indexOf('<', start + 1);
		if (start > end)
			addString(text.substring(end, start));
		if (start >= 0) {
			end = text.indexOf('>', start);
			// Filter out escaped '\>'
			while (end > 0 && text.charAt(end - 1) === '\\')
				end = text.indexOf('>', end + 1);
			if (end === -1) {
				// Non-closing tag. Add rest of string and bail out
				addString(text.substring(start));
				break;
			}
			end++; // Increase by one since we're using it for substring()
			var closing = text.charAt(start + 1) === '/';
			// empty = contentless tag: <tag/>
			var empty = !closing && text.charAt(end - 2) === '/';
			var definition = text.substring(start + (closing ? 2 : 1),
					end - (empty ? 2 : 1));
			// There is a special convention in place for empty tags:
			// These are interpretated as empty tags:
			// <tag/>, <tag />, <tag param />
			// Thes are not an empty tags. The / is regarded as part of the
			// parameter instead:
			// <tag param/ >, <tag param/>
			// This is to make unnamed url parameters easy to handle, among
			// other things. Detect this here:
			// If the tag definition contains white space, we have
			// parameters. If such a tag ended with / and the last char is
			// not white, it's not actually an empty tag but the / is  part
			// of the parameter:
			if (empty && /\s.*[^\s]$/.test(definition)) {
				empty = false;
				definition += '/';
			}
			var closeTag = null;
			if (!closing || empty) {
				// Opening tag, pass current tag as parent
				tag = Node.create(definition, tag, options);
				// If this tag does not allow nesting, search for its end
				// immediately now, all what's inbetween to its nodes and
				// close it straight away.
				if (!empty && tag.nesting === false) {
					// Search for closing tag
					var close = '</' + tag.name + '>';
					start = text.indexOf(close, end);
					if (start >= 0) {
						// Found it, add the part
						addString(text.substring(end, start));
						end = start + close.length;
						// Close this tag now (see below):
						closeTag = tag;
					}
				}
			}
			if (closing || empty) {
				// Closing tag
				closeTag = tag;
				// Walk up hierarchy until we find opening tag:
				while(!empty && closeTag && closeTag.name !== definition)
					closeTag = closeTag.parent;
			}
			if (closeTag && closeTag !== rootTag) {
				// Activate parent tag
				tag = closeTag.parent;
				// Add the closed tag to its parent's nodes and set its
				// index inside the nodes array, as required by renderNode()
				closeTag.index = tag.nodes.push(closeTag) - 1;
			}
		}
	}
	if (end > start)
		rootTag.nodes.push(text.substring(end));
	return rootTag;
};

	// Parses the passed text into a DOM tree and renders it directly.
exports.render = function(text, options) {
	var root = this.parse(text, options);
	return root && root.render(options) || '';
};

function dontEncode(str) {
	return str;
}

function Node() {
}

Node.prototype = {
	renderNode: function(node, options, encode) {
		if (node.render && (!options || !options.allowedTags
				|| options.allowedTags[node.name])) {
			// Prevent nodes from rendering more than once by caching the
			// result, useful e.g. when a tag uses renderNode to render
			// selected nodes.
			if (node.rendered)
				return node.rendered;
			// Allow tags to override the encode function. They can also set it
			// to false, meaning no encoding.
			if (node.encode !== undefined)
				encode = node.encode || dontEncode;
			// This is a tag, render its children first into one content
			// string
			var content = node.renderChildren(options, encode);
			// Now render the tag itself and place it in the resulting
			// buffer
			return node.rendered = node.render(content, options, encode,
					this.nodes[node.index - 1], this.nodes[node.index + 1]);
		} else {
			// A simple string. Just encode it
			return encode(node);
		}
	},

	renderChildren: function(options, encode, start, end) {
		var buffer = new Array(this.nodes.length);
		for (var i = start || 0, l = end || this.nodes.length; i < l; i++) {
			buffer[i] = this.renderNode(this.nodes[i], options, encode);
		}
		return buffer.join('');
	},

	toString: function() {
		// Since nodes contains both strings and tags, join calls toString
		// on each of them, resulting in automatic toString recursion for
		// child tags.
		var content = this.nodes.join('');
		return '<' + this.definition + (content 
				? '>' + content + '</' + this.name + '>' 
				: '/>');
	},

	mergeAttributes: function(definition) {
		// definition is the result of parsing attribuets definition in inject.
		// If attributes were defined, use the attributes object produced by
		// Node.parse() now to scan through defined named attributes and
		// unnamed values, and use default values if available.
		var attributes = this.attributes;
		var values = this.values;
		var index = 0;
		var attribs = definition.attributes;
		for (var i = 0, l = attribs.length; i < l; i++) {
			var attrib = attribs[i];
			// If the tag does not define this predefined attribute,
			// either take its value from the unnamed values,
			// and increase index, or use its default value.
			if (attributes[attrib.name] === undefined) {
				// Use default value if running out of unnamed args
				attributes[attrib.name] = values
						&& index < values.length ? values[index++]
								: attrib.defaultValue;
			}
			// If the attributes definition does not contain any more
			// defaults and we are running out of unnamed values, we
			// might as well drop out of the loop since there won't be
			// anything to be done.
			if (!attrib.defaultsFollow && (!values || index >= values.length))
				break;
		}
		// Cut away consumed unnamed values
		if (values && index > 0)
			values.splice(0, index);
	},

	renderAttributes: function(attributes) {
		attributes = attributes || this.attributes;
		var parts = [];
		for (var key in attributes)
			parts.push(key + '="' + attributes[key] + '"');
		return parts.join(' ');			
	}
};

Node.create = function(definition, parent, options) {
	// Parse tag definition for attributes (named) and values (unnamed).
	var tag = Node.parse(definition, options);
	tag.definition = definition;
	tag.parent = parent;
	tag.nodes = [];
	// Setup children list, and previous / next references
	tag.children = [];
	if (parent) {
		var siblings = parent.children;
		tag.previous = siblings[siblings.length - 1];
		if (tag.previous)
			tag.previous.next = tag;
		siblings.push(tag);
	}
	if (tag.initialize)
		tag.initialize();
	return tag;
};


// Parses tag definitions (everything wihtout the trailing '<' & '>'). This is
// used both when creating a tag object from a tag string and when parsing
// attributes definitions, in which case collectAttributes  is set to true and
// the method collects different information, see bellow.
Node.parse = function(definition, options, collectAttributes) {
	if (definition === 'root') {
		var obj = new (contexts[options && options.context || 'default']['root']
				|| contexts['default']['root'])();
		obj.name = definition;
		return obj;	
	}
	// When collectAttributes is true, list holds the array of attribute
	// definitions and lookup the lowercase attribute name lookup table.
	var name = null;
	var list = [];
	var attribute = null;
	var attributes = {};
	var lookup = {};
	var tag;
	var proto;
	// Match either name= parts, string parts (supporting both ' and ", and 
	// escaped quotes inside), and pure value parts (in collectAttributes mode
	// these can also be attribute names without default values):
	var parser = /(\w+)=|(["'](?:[^"'\\]*(?:\\["']|\\|(?=["']))+)*["'])|(\S+)/gm;
	// TODO: See which version is faster, replace or repeated calls to exec?
	// definition.replace(parser, function() {
	// 	var match = arguments;
	for (var match; match = parser.exec(definition);) {
		if (match[1]) { // attribute name
			attribute = match[1];
		} else { // string or value
			// Do not eval match[2] as it might contain line breaks which will
			// throw errors. Instead, just take away the quotes and filter out
			// escape chars.
			var value = match[2];
			value = value && value.substring(1, value.length - 1).replace(
						/\\/g, '')
					|| match[3];
			if (collectAttributes) {
				// When collecting attributes, use list array to store them
				if (!attribute) {
					// attribute with no default value
					attribute = value;
					value = undefined;
				}
				list.push({ name: attribute, defaultValue: value });
				// See if there's a lowercase version, and if so, put it into
				// the list of attributes name translation lookup:
				var lower = attribute.toLowerCase();
				if (lower !== attribute)
					lookup[lower] = attribute;
			} else {
				// Normal tag parsing: Find tag name, create tag for it and
				// store named attributes and unnamed values. Merge attributes
				// definition into it at the end.
				if (!name) {
					// The first value is the tag name. Once we know it, we can
					// determine the ctor to be used and from there the attribs
					// definition and name translation lookup.
					name = value;
					// Render any undefined tag through the UndefinedTag.
					var context = options && contexts[options.context]
							|| contexts['default'];
					// Fetch the contstructor for this tag, and use it to create
					// the tag object.
					var ctor = context[name] || contexts['default'][name]
							|| context['undefined']
							|| contexts['default']['undefined'];
					tag = new ctor();
					tag.name = name;
					tag.values = list;
					tag.attributes = attributes;
					// Now get the attribute name translation lookup:
					proto = ctor.prototype;
					lookup = proto.attributes && proto.attributes.lookup
							|| lookup;
				} else if (attribute) {
					// named attribute. Use definition.lookup to translate to
					// mixed case name.
					attribute = lookup[attribute] || attribute;
					attributes[attribute] = value;
				} else { // unnamed argument
					list.push(value);
				}
			}
			// Reset attribute name again
			attribute = null;
		}
	}
	if (collectAttributes) {
		// Scan backwards to see wether further attributes define defaults.
		// This is needed to stop looping through attributes early once no more
		// defaults are available and unnamed values are used up.
		// See Node#create
		var defaultsFollow = false;
		for (var i = list.length - 1; i >= 0; i--) {
			list[i].defaultsFollow = defaultsFollow;
			defaultsFollow = defaultsFollow
					|| list[i].defaultValue !== undefined;
		}
		// Return both the attributes definition and the name lookup
		return list.length > 0 ? {
			attributes: list,
			lookup: lookup
		} : null;
	} else {
		// Normal tag parsing: Merge attribute definitions with the one from
		// the prototype.
		if (proto.attributes)
			tag.mergeAttributes(proto.attributes);
		return tag;
	}
};

// The root tag is there to contain all other markup tags and content nodes and 
// is produced internally in and returned by tags.parse(). Call render on it
// to render the parsed tags tree.
exports.register({
	'root': {
		// The root tag's render function is different as it is used to render
		// the whole tree and does not receive content or encode as parameters.
		render: function(options) {
			if (options && typeof options.allowedTags === 'string') {
				var names = options.allowedTags.split(',');
				var allowed = options.allowedTags = {};
				for (var i = 0, l = names.length; i < l; i++)
					allowed[names[i]] = true;
			}
			// Determine the encode function to be used, the default is none
			var encode = options && options.encode || dontEncode;
			return this.renderChildren(options, encode);
		}
	},

	// Special tag to handle the rendering of all the undefined tags.
	// By default it renders the markup unmodified, but can be overridden.
	'undefined': {
		render: function(content, options, encode) {
			return encode('<' + this.definition) + (content 
					? encode('>') + content + encode('</' + this.name + '>') 
					: encode('/>'));
		}
	}
});

})(typeof exports !== 'undefined' ? exports : this.marks = {});
