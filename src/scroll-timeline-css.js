import { StyleParser } from "./scroll-timeline-css-parser";
import { ProxyAnimation } from "./proxy-animation"
import { ScrollTimeline, ViewTimeline, getScrollParent, calculateRange,
  calculateRelativePosition, measureSubject, measureSource } from "./scroll-timeline-base";

const parser = new StyleParser();

function initMutationObserver() {
  const sheetObserver = new MutationObserver((entries) => {
    for (const entry of entries) {
      for (const addedNode of entry.addedNodes) {
        if (addedNode instanceof HTMLStyleElement) {
          handleStyleTag(addedNode);
        }
        if (addedNode instanceof HTMLLinkElement) {
          handleLinkedStylesheet(addedNode);
        }
      }
    }

    // TODO: Proxy element.style similar to how we proxy element.animate.
    // We accomplish this by swapping out Element.prototype.style.
  });

  sheetObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  /**
   * @param {HtmlStyleElement} el style tag to be parsed
   */
  function handleStyleTag(el) {
    // Don’t touch empty style tags.
    if (el.innerHTML.trim().length === 0) {
      return;
    }
    // TODO: Do with one pass for better performance
    let newSrc = parser.transpileStyleSheet(el.innerHTML, true);
    newSrc = parser.transpileStyleSheet(newSrc, false);
    el.innerHTML = newSrc;
  }

  function handleLinkedStylesheet(el) {
    // TODO
  }

  document.querySelectorAll("style").forEach((tag) => handleStyleTag(tag));
  document
    .querySelectorAll("link")
    .forEach((tag) => handleLinkedStylesheet(tag));
}

function relativePosition(phase, container, target, axis, optionsInset, percent) {
  const sourceMeasurements = measureSource(container)
  const subjectMeasurements = measureSubject(container, target)
  const phaseRange = calculateRange(phase, sourceMeasurements, subjectMeasurements, axis, optionsInset);
  const coverRange = calculateRange('cover', sourceMeasurements, subjectMeasurements, axis, optionsInset);
  return calculateRelativePosition(phaseRange, percent, coverRange);
}

function createScrollTimeline(anim, animationName, target) {
  const animOptions = parser.getAnimationTimelineOptions(animationName, target);

  if(!animOptions)
    return null;

  const timelineName = animOptions['animation-timeline'];
  if(!timelineName) return null;

  let options = parser.getScrollTimelineOptions(timelineName, target) ||
    parser.getViewTimelineOptions(timelineName, target);
  if (!options) return null;

  // If this is a ViewTimeline
  if(options.subject)
    updateKeyframesIfNecessary(anim, options);

  return {
    timeline: options.source ? new ScrollTimeline(options) : new ViewTimeline(options),
    animOptions: animOptions
  };
}

function updateKeyframesIfNecessary(anim, options) {
  const container = getScrollParent(options.subject);
  const axis = (options.axis || options.axis);

  function calculateNewOffset(mapping, keyframe) {
    let newOffset = null;
    for(const [key, value] of mapping) {
      if(key == keyframe.offset * 100) {
        if(value == 'from') {
          newOffset = 0;
        } else if(value == 'to') {
          newOffset = 100;
        } else {
          const tokens = value.split(" ");
          if(tokens.length == 1) {
            newOffset = parseFloat(tokens[0]);
          } else {
            newOffset = relativePosition(tokens[0], container, options.subject,
              axis, options.inset, CSS.percent(parseFloat(tokens[1]))) * 100;
          }
        }
        break;
      }
    }

    return newOffset;
  }

  const mapping = parser.keyframeNamesSelectors.get(anim.animationName);
  // mapping is empty when none of the keyframe selectors contains a phase
  if(mapping && mapping.size) {
    const newKeyframes = [];
    anim.effect.getKeyframes().forEach(keyframe => {
      const newOffset = calculateNewOffset(mapping, keyframe);
      if(newOffset !== null && newOffset >= 0 && newOffset <= 100) {
        keyframe.offset = newOffset / 100.0;
        newKeyframes.push(keyframe);
      }
    });

    const sortedKeyframes = newKeyframes.sort((a, b) => {
      if(a.offset < b.offset) return -1;
      if(a.affset > b.offset) return 1;
      return 0;
    });

    anim.effect.setKeyframes(sortedKeyframes);
  }
}

export function initCSSPolyfill() {
  // Don't load if browser claims support
  if (CSS.supports("animation-timeline: --works")) {
    return true;
  }

  initMutationObserver();

  // We are not wrapping capturing 'animationstart' by a 'load' event,
  // because we may lose some of the 'animationstart' events by the time 'load' is completed.
  window.addEventListener('animationstart', (evt) => {
    evt.target.getAnimations().filter(anim => anim.animationName === evt.animationName).forEach(anim => {
      const result = createScrollTimeline(anim, anim.animationName, evt.target);
      if (result) {
        // If the CSS Animation refers to a scroll or view timeline we need to proxy the animation instance.
        if (result.timeline && !(anim instanceof ProxyAnimation)) {
          const proxyAnimation = new ProxyAnimation(anim, result.timeline, result.animOptions);
          anim.pause();
          proxyAnimation.play();
        } else {
          // If the timeline was removed or the animation was already an instance of a proxy animation,
          // invoke the set the timeline procedure on the existing animation.
          anim.timeline = result.timeline;
        }
      }
    });
  });
}
