/*************************************************************
 *
 *  Copyright (c) 2018 The MathJax Consortium
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */


/**
 * @fileoverview The AMS Parse methods.
 *
 * @author v.sorge@mathjax.org (Volker Sorge)
 */


import {StackItem} from '../StackItem.js';
import {ParseMethod} from '../Types.js';
import ParseUtil from '../ParseUtil.js';
import NodeUtil from '../NodeUtil.js';
import {TexConstant} from '../TexConstants.js';
import TexParser from '../TexParser.js';
import TexError from '../TexError.js';
import {Label} from '../Tags.js';
import {Macro} from '../Symbol.js';
import {CommandMap} from '../SymbolMap.js';
import {MapHandler} from '../MapHandler.js';
import {ArrayItem} from '../base/BaseItems.js';
import BaseMethods from '../base/BaseMethods.js';
import {MmlNode, TEXCLASS} from '../../../core/MmlTree/MmlNode.js';
import {MmlMo} from '../../../core/MmlTree/MmlNodes/mo.js';
import {MmlMunderover} from '../../../core/MmlTree/MmlNodes/munderover.js';


// Namespace
let AmsMethods: Record<string, ParseMethod> = {};


// TODO: do we really need style?
AmsMethods.AmsEqnArray = function(parser: TexParser, begin: StackItem,
                                      numbered: boolean, taggable: boolean,
                                      align: string, spacing: string,
                                      style: string) {
  // @test Aligned, Gathered
  const args = parser.GetBrackets('\\begin{' + begin.getName() + '}');
  const array = BaseMethods.EqnArray(parser, begin, numbered, taggable, align, spacing, style);
  return ParseUtil.setArrayAlign(array as ArrayItem, args);
};


/**
 *  Handle alignat environments
 */
AmsMethods.AlignAt = function(parser: TexParser, begin: StackItem,
                              numbered: boolean, taggable: boolean) {
  const name = begin.getName();
  let n, valign, align = '', spacing = [];
  if (!taggable) {
    // @test Alignedat
    valign = parser.GetBrackets('\\begin{' + name + '}');
  }
  n = parser.GetArgument('\\begin{' + name + '}');
  if (n.match(/[^0-9]/)) {
    throw new TexError(['PositiveIntegerArg',
                        'Argument to %1 must me a positive integer',
                        '\\begin{' + name + '}']);
  }
  let count = parseInt(n, 10);
  while (count > 0) {
    align  += 'rl';
    spacing.push('0em 0em');
    count--;
  }
  let spaceStr = spacing.join(' ');
  if (taggable) {
    // @test Alignat, Alignat Star
    return AmsMethods.EqnArray(parser, begin, numbered, taggable, align, spaceStr);
  }
  // @test Alignedat
  let array = AmsMethods.EqnArray(parser, begin, numbered, taggable, align, spaceStr);
  return ParseUtil.setArrayAlign(array as ArrayItem, valign);
};


/**
 *  Implements multline environment (mostly handled through STACKITEM below)
 */
AmsMethods.Multline = function (parser: TexParser, begin: StackItem, numbered: boolean) {
  // @test Shove*, Multline
  parser.Push(begin);
  ParseUtil.checkEqnEnv(parser);
  const item = parser.itemFactory.create('multline', numbered, parser.stack);
  item.arraydef = {
    displaystyle: true,
    rowspacing: '.5em',
    columnwidth: '100%',
    width: parser.options.get('MultLineWidth'),
    side: parser.options.get('TagSide'),
    minlabelspacing: parser.options.get('TagIndent')
  };
  return item;
};


// TODO: How to set an extra definition. Probably best to deal with this
//       together with newcommand, setEnv etc.
// 
AmsMethods.HandleDeclareOp =  function (parser: TexParser, name: string) {
  let limits = (parser.GetStar() ? '' : '\\nolimits\\SkipLimits');
  let cs = ParseUtil.trimSpaces(parser.GetArgument(name));
  if (cs.charAt(0) === '\\') {
    cs = cs.substr(1);
  }
  let op = parser.GetArgument(name);
  op = op.replace(/\*/g, '\\text{*}').replace(/-/g, '\\text{-}');
  // TODO: Use a better dedicated handler.
  //       What about already defined commands?
  (MapHandler.getInstance().getMap('new-Command') as CommandMap).
    add(cs, new Macro(cs, AmsMethods.Macro, ['\\mathop{\\rm ' + op + '}' + limits]));
};


AmsMethods.HandleOperatorName = function(parser: TexParser, name: string) {
  // @test Operatorname
  const limits = (parser.GetStar() ? '' : '\\nolimits\\SkipLimits');
  let op = ParseUtil.trimSpaces(parser.GetArgument(name));
  op = op.replace(/\*/g, '\\text{*}').replace(/-/g, '\\text{-}');
  parser.string = '\\mathop{\\rm ' + op + '}' + limits + ' ' +
    parser.string.slice(parser.i);
  parser.i = 0;
};


AmsMethods.SkipLimits = function(parser: TexParser, name: string) {
  // @test Operatorname
  const c = parser.GetNext(), i = parser.i;
  if (c === '\\' && ++parser.i && parser.GetCS() !== 'limits') {
    parser.i = i;
  }
};


AmsMethods.MultiIntegral = function(parser: TexParser, name: string,
                                    integral: string) {
  let next = parser.GetNext();
  if (next === '\\') {
    // @test MultiInt with Command
    let i = parser.i;
    next = parser.GetArgument(name);
    parser.i = i;
    if (next === '\\limits') {
      if (name === '\\idotsint') { 
       // @test MultiInt with Limits
        integral = '\\!\\!\\mathop{\\,\\,' + integral + '}';
      }
      else {
        // Question: This is not used anymore?
        integral = '\\!\\!\\!\\mathop{\\,\\,\\,' + integral + '}';
      }
    }
  }
  // @test MultiInt, MultiInt in Context
  parser.string = integral + ' ' + parser.string.slice(parser.i);
  parser.i = 0;
};


/**
 *  Handle stretchable arrows
 */
AmsMethods.xArrow = function(parser: TexParser, name: string,
                             chr: number, l: number, r: number) {
  let def = {width: '+' + (l + r) + 'mu', lspace: l + 'mu'};
  let bot = parser.GetBrackets(name);
  let top = parser.ParseArg(name);
  let arrow = parser.configuration.nodeFactory.create('token', 
    'mo', {stretchy: true, texClass: TEXCLASS.REL}, String.fromCharCode(chr));
  let mml = parser.configuration.nodeFactory.create('node', 'munderover', [arrow], {}) as MmlMunderover;
  let mpadded = parser.configuration.nodeFactory.create('node', 'mpadded', [top], def);
  NodeUtil.setProperties(mpadded, {voffset: '.15em'});
  NodeUtil.setData(mml, mml.over, mpadded);
  if (bot) {
    // @test Above Below Left Arrow, Above Below Right Arrow
    let bottom = new TexParser(bot, parser.stack.env, parser.configuration).mml();
    mpadded = parser.configuration.nodeFactory.create('node', 'mpadded', [bottom], def);
    NodeUtil.setProperties(mpadded, {voffset: '-.24em'});
    NodeUtil.setData(mml, mml.under, mpadded);
  }
  // @test Above Left Arrow, Above Right Arrow, Above Left Arrow in Context,
  //       Above Right Arrow in Context
  NodeUtil.setProperties(mml, {subsupOK: true});
  parser.Push(mml);
};


/**
 *  Record presence of \shoveleft and \shoveright
 */
AmsMethods.HandleShove = function(parser: TexParser, name: string,
                                  shove: string) {
  let top = parser.stack.Top();
  // @test Shove (Left|Right) (Top|Middle|Bottom)
  if (top.kind !== 'multline') {
    // @test Shove Error Environment
    throw new TexError(['CommandOnlyAllowedInEnv',
                        '%1 only allowed in %2 environment',
                        name, 'multline']);
  }
  if (top.Size()) {
    // @test Shove Error (Top|Middle|Bottom)
    throw new TexError(['CommandAtTheBeginingOfLine',
                        '%1 must come at the beginning of the line', name]);
  }
  top.setProperty('shove', shove);
};


/**
 *  Handle \cfrac
 */
AmsMethods.CFrac = function(parser: TexParser, name: string) {
  let lr  = ParseUtil.trimSpaces(parser.GetBrackets(name, ''));
  let num = parser.GetArgument(name);
  let den = parser.GetArgument(name);
  let lrMap: {[key: string]: string} = {
    l: TexConstant.Align.LEFT, r: TexConstant.Align.RIGHT, '': ''};
  let numNode = new TexParser('\\strut\\textstyle{' + num + '}',
                              parser.stack.env, parser.configuration).mml();
  let denNode = new TexParser('\\strut\\textstyle{' + den + '}',
                              parser.stack.env, parser.configuration).mml();
  let frac = parser.configuration.nodeFactory.create('node', 'mfrac', [numNode, denNode], {});
  lr = lrMap[lr];
  if (lr == null) {
    // @test Center Fraction Error
    throw new TexError(['IllegalAlign', 'Illegal alignment specified in %1', name]);
  }
  if (lr) {
    // @test Right Fraction, Left Fraction
    NodeUtil.setProperties(frac, {numalign: lr, denomalign: lr});
  }
  // @test Center Fraction
  parser.Push(frac);
};


/**
 *  Implement AMS generalized fraction
 */
AmsMethods.Genfrac = function(parser: TexParser, name: string, left: string,
                              right: string, thick: string, style: string) {
  if (left  == null) { // @test Genfrac
    left = parser.GetDelimiterArg(name);
  }
  if (right == null) { // @test Genfrac
    right = parser.GetDelimiterArg(name);
  }
  if (thick == null) { // @test Genfrac
    thick = parser.GetArgument(name);
  }
  if (style == null) { // @test Genfrac
    style = ParseUtil.trimSpaces(parser.GetArgument(name));
  }
  let num = parser.ParseArg(name);
  let den = parser.ParseArg(name);
  let frac = parser.configuration.nodeFactory.create('node', 'mfrac', [num, den], {});
  if (thick !== '') {
    // @test Normal Binomial, Text Binomial, Display Binomial
    NodeUtil.setAttribute(frac, 'linethickness', thick);
  }
  if (left || right) {
    // @test Normal Binomial, Text Binomial, Display Binomial
    NodeUtil.setProperties(frac, {withDelims: true});
    frac = ParseUtil.fixedFence(parser.configuration, left, frac, right);
  }
  if (style !== '') {
    let styleDigit = parseInt(style, 10);
    let styleAlpha = ['D', 'T', 'S', 'SS'][styleDigit];
    if (styleAlpha == null) {
      // @test Genfrac Error
      throw new TexError(['BadMathStyleFor', 'Bad math style for %1', name]);
    }
    frac = parser.configuration.nodeFactory.create('node', 'mstyle', [frac], {});
    if (styleAlpha === 'D') {
      // @test Display Fraction, Display Sub Fraction, Display Binomial,
      //       Display Sub Binomial
      NodeUtil.setProperties(frac, {displaystyle: true, scriptlevel: 0});
    }
    else {
      // @test Text Fraction, Text Sub Fraction, Text Binomial,
      //       Text Sub Binomial
      NodeUtil.setProperties(frac, {displaystyle: false,
                                      scriptlevel: styleDigit - 1});
    }
  }
  // @test Text Fraction, Normal Sub Binomial, Normal Binomial
  parser.Push(frac);
};



/**
 *  Add the tag to the environment (to be added to the table row later)
 * tag is 
 */
AmsMethods.HandleTag = function(parser: TexParser, name: string) {
  if (!parser.tags.currentTag.taggable && parser.tags.env) {
    throw new TexError(['CommandNotAllowedInEnv',
                        '%1 not allowed in %2 environment',
                        name, parser.tags.env]);
  }
  // TODO: sort out empty strings in tagId!
  if (parser.tags.currentTag.tag) {
    throw new TexError(['MultipleCommand', 'Multiple %1', name]);
  }
  let star = parser.GetStar();
  let tagId = ParseUtil.trimSpaces(parser.GetArgument(name));
  parser.tags.tag(tagId, star);
};


AmsMethods.HandleNoTag = BaseMethods.HandleNoTag;

AmsMethods.HandleRef = BaseMethods.HandleRef;

AmsMethods.Macro = BaseMethods.Macro;

AmsMethods.Accent = BaseMethods.Accent;

AmsMethods.Tilde = BaseMethods.Tilde;

AmsMethods.Array = BaseMethods.Array;

AmsMethods.Spacer = BaseMethods.Spacer;

AmsMethods.NamedOp = BaseMethods.NamedOp;

AmsMethods.EqnArray = BaseMethods.EqnArray;

export default AmsMethods;
